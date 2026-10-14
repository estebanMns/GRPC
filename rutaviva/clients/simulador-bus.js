// Simulador de bus (conductor): envía su GPS en lote con client streaming (RF3)
const { crearCliente } = require('./cargar-proto');

const BUS_ID = process.env.BUS_ID || 'B-101';
const PUNTOS = Number(process.env.PUNTOS || 30);
const INTERVALO_MS = Number(process.env.INTERVALO_MS || 1000);

const client = crearCliente();

function enviarLote() {
  return new Promise((resolve, reject) => {
    const call = client.ReportarUbicaciones((err, resumen) => {
      if (err) return reject(err);
      resolve(resumen);
    });

    let lat = 4.711, lon = -74.072, enviados = 0; // salida desde Bogotá
    const t = setInterval(() => {
      lat += 0.002; lon += 0.001;
      call.write({
        bus_id: BUS_ID,
        coordenada: { latitud: lat, longitud: lon },
        velocidad_kmh: 40 + Math.random() * 20,
        registrada_en: { seconds: Math.floor(Date.now() / 1000), nanos: 0 },
      });
      if (++enviados === PUNTOS) {
        clearInterval(t);
        call.end();
      }
    }, INTERVALO_MS);
  });
}

// Cloud Run corta streams al llegar al timeout: reintenta si la conexión cae
async function main(intentos = 3) {
  for (let i = 1; i <= intentos; i++) {
    try {
      const resumen = await enviarLote();
      console.log('Resumen del recorrido:', resumen);
      return;
    } catch (err) {
      console.error(`Intento ${i} fallido: ${err.message}`);
    }
  }
  process.exitCode = 1;
}

main().finally(() => client.close());
