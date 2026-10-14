const fs = require('fs');
const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

// El .proto vive en ../proto en local y en ./proto dentro de la imagen Docker
const protoCandidates = [
  path.join(__dirname, 'proto', 'rutaviva.proto'),
  path.join(__dirname, '..', 'proto', 'rutaviva.proto'),
];
const protoFile = protoCandidates.find((p) => fs.existsSync(p));

const def = protoLoader.loadSync(protoFile, {
  keepCase: true, longs: String, enums: String, defaults: true,
});
const { FlotaService } = grpc.loadPackageDefinition(def).rutaviva.v1;

// Datos de demostración (en producción vendrían de una base de datos)
const buses = new Map([
  ['B-101', { bus_id: 'B-101', placa: 'TSQ-482', ruta: 'BOG-TUN',
              conductor: 'Ana Ríos', estado: 'EN_RUTA' }],
]);
const rutas = [
  { codigo: 'BOG-TUN', origen: 'Bogotá', destino: 'Tunja' },
];

function esPosicionValida(p) {
  const c = p.coordenada || {};
  return Number.isFinite(c.latitud) && Number.isFinite(c.longitud) &&
    Math.abs(c.latitud) <= 90 && Math.abs(c.longitud) <= 180 &&
    Number.isFinite(p.velocidad_kmh) && p.velocidad_kmh >= 0;
}

function haversineKm(a, b) {
  const R = 6371, rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.latitud - a.latitud), dLon = rad(b.longitud - a.longitud);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitud)) * Math.cos(rad(b.latitud)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function buildServer() {
  const seguidores = new Map(); // bus_id -> Set de streams abiertos
  const salasChat = new Map();  // bus_id -> Set de streams de chat

  // RF1 - Unaria
  function ObtenerBus(call, callback) {
    const bus = buses.get(call.request.bus_id);
    if (!bus) return callback({ code: grpc.status.NOT_FOUND, message: 'Bus no existe' });
    callback(null, bus);
  }

  // RF2 - Server streaming: se guarda el stream y se le escribe cada posición nueva
  function SeguirBus(call) {
    const id = call.request.bus_id;
    if (!buses.has(id)) {
      return call.emit('error', { code: grpc.status.NOT_FOUND, message: 'Bus no existe' });
    }
    if (!seguidores.has(id)) seguidores.set(id, new Set());
    seguidores.get(id).add(call);
    const quitar = () => seguidores.get(id)?.delete(call);
    call.on('cancelled', quitar);
    call.on('error', quitar);
  }

  // RF3 - Client streaming: llegan muchas posiciones, se responde un resumen al final
  function ReportarUbicaciones(call, callback) {
    let puntos = 0, distancia = 0, sumaVel = 0, anterior = null, busId = '';
    call.on('data', (p) => {
      if (!esPosicionValida(p)) return; // coordenadas fuera de rango o velocidad negativa
      puntos++; sumaVel += p.velocidad_kmh; busId = p.bus_id;
      if (anterior) distancia += haversineKm(anterior, p.coordenada);
      anterior = p.coordenada;
      // Reenvía la posición a todos los pasajeros que siguen este bus
      (seguidores.get(p.bus_id) || new Set()).forEach((s) => s.write(p));
    });
    call.on('error', () => {});
    call.on('end', () => callback(null, {
      bus_id: busId, puntos_recibidos: puntos, distancia_km: distancia,
      velocidad_promedio_kmh: puntos ? sumaVel / puntos : 0,
    }));
  }

  // RF4 - Bidireccional: cada mensaje se reenvía a todos en la sala del bus
  function Chat(call) {
    let sala = null;
    call.on('data', (msg) => {
      if (sala !== msg.bus_id) {
        if (sala) salasChat.get(sala)?.delete(call);
        sala = msg.bus_id;
        if (!salasChat.has(sala)) salasChat.set(sala, new Set());
        salasChat.get(sala).add(call);
      }
      salasChat.get(sala).forEach((c) => c.write(msg));
    });
    call.on('error', () => {});
    call.on('end', () => { salasChat.get(sala)?.delete(call); call.end(); });
  }

  // RF5 - Unaria
  function ListarRutas(_call, callback) {
    callback(null, { rutas });
  }

  const server = new grpc.Server();
  server.addService(FlotaService.service,
    { ObtenerBus, ListarRutas, SeguirBus, ReportarUbicaciones, Chat });
  return server;
}

module.exports = { buildServer, esPosicionValida, haversineKm };

// Arranque solo si se ejecuta directamente (no al importarlo desde los tests)
if (require.main === module) {
  // Cloud Run indica el puerto en la variable PORT; TLS lo termina la plataforma
  const port = process.env.PORT || 50051;
  buildServer().bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), (err) => {
    if (err) throw err;
    console.log(`FlotaService escuchando en ${port}`);
  });
}
