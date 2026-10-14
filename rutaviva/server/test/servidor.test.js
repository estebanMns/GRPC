const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { buildServer } = require('../index.js');

const def = protoLoader.loadSync(path.join(__dirname, '..', '..', 'proto', 'rutaviva.proto'), {
  keepCase: true, longs: String, enums: String, defaults: true,
});
const { FlotaService } = grpc.loadPackageDefinition(def).rutaviva.v1;

let server, client;

before(async () => {
  server = buildServer();
  const port = await new Promise((resolve, reject) =>
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(),
      (err, p) => (err ? reject(err) : resolve(p))));
  client = new FlotaService(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
});

after(() => {
  client.close();
  server.forceShutdown();
});

const ahora = () => ({ seconds: Math.floor(Date.now() / 1000), nanos: 0 });
const posicion = (lat, lon, vel = 50) => ({
  bus_id: 'B-101', coordenada: { latitud: lat, longitud: lon },
  velocidad_kmh: vel, registrada_en: ahora(),
});

test('ObtenerBus devuelve el bus correcto (RF1)', async () => {
  const bus = await new Promise((res, rej) =>
    client.ObtenerBus({ bus_id: 'B-101' }, (e, r) => (e ? rej(e) : res(r))));
  assert.equal(bus.placa, 'TSQ-482');
  assert.equal(bus.estado, 'EN_RUTA');
});

test('ObtenerBus devuelve NOT_FOUND para un ID inexistente (RF1)', async () => {
  await assert.rejects(
    new Promise((res, rej) => client.ObtenerBus({ bus_id: 'X-999' }, (e, r) => (e ? rej(e) : res(r)))),
    (e) => e.code === grpc.status.NOT_FOUND,
  );
});

test('ListarRutas devuelve al menos una ruta (RF5)', async () => {
  const r = await new Promise((res, rej) =>
    client.ListarRutas({}, (e, resp) => (e ? rej(e) : res(resp))));
  assert.ok(r.rutas.length >= 1);
});

test('ReportarUbicaciones cuenta solo las posiciones válidas (RF3 y validación)', async () => {
  const resumen = await new Promise((res, rej) => {
    const call = client.ReportarUbicaciones((e, r) => (e ? rej(e) : res(r)));
    call.write(posicion(4.7, -74.0));
    call.write(posicion(4.8, -74.1));
    call.write(posicion(95, -74.0));      // latitud fuera de rango: descartada
    call.write(posicion(4.7, -200));      // longitud fuera de rango: descartada
    call.write(posicion(4.7, -74.0, -5)); // velocidad negativa: descartada
    call.end();
  });
  assert.equal(resumen.puntos_recibidos, 2);
  assert.ok(resumen.distancia_km > 0);
});

test('SeguirBus recibe las posiciones enviadas por ReportarUbicaciones sin polling (RF2)', async () => {
  const seguidas = [];
  const seguir = client.SeguirBus({ bus_id: 'B-101' });
  seguir.on('data', (p) => seguidas.push(p));
  await new Promise((r) => setTimeout(r, 50)); // dar tiempo a registrar el stream

  await new Promise((res, rej) => {
    const call = client.ReportarUbicaciones((e) => (e ? rej(e) : res()));
    call.write(posicion(4.71, -74.07));
    call.write(posicion(4.72, -74.08));
    call.end();
  });
  await new Promise((r) => setTimeout(r, 100));
  seguir.cancel();

  assert.equal(seguidas.length, 2);
  assert.equal(seguidas[0].coordenada.latitud, 4.71);
});

test('SeguirBus devuelve NOT_FOUND para un bus inexistente (RF2)', async () => {
  const seguir = client.SeguirBus({ bus_id: 'X-999' });
  const err = await new Promise((res) => seguir.on('error', res));
  assert.equal(err.code, grpc.status.NOT_FOUND);
});

test('Chat reenvía los mensajes entre dos clientes en tiempo real (RF4)', async () => {
  const conductor = client.Chat();
  const central = client.Chat();
  const recibidoPorConductor = new Promise((res) => conductor.on('data', (m) => res(m)));
  const recibidoPorCentral = new Promise((res) => central.on('data', (m) => res(m)));

  await new Promise((r) => setTimeout(r, 50));
  central.write({ remitente: 'central', bus_id: 'B-101', texto: 'Hola conductor', enviado_en: ahora() });

  const a = await recibidoPorConductor;
  const b = await recibidoPorCentral;
  assert.equal(a.texto, 'Hola conductor');
  assert.equal(b.texto, 'Hola conductor');

  conductor.end();
  central.end();
});
