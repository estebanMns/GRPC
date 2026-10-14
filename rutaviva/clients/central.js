// Consola de la central: consulta un bus (RF1) y chatea con el conductor (RF4)
const readline = require('readline');
const { crearCliente } = require('./cargar-proto');

const BUS_ID = process.env.BUS_ID || 'B-101';
const client = crearCliente();

client.ObtenerBus({ bus_id: BUS_ID }, (err, bus) => {
  if (err) {
    console.error(`ObtenerBus falló (${err.code}): ${err.details || err.message}`);
    client.close();
    process.exit(1);
  }
  console.log(`Bus ${bus.bus_id} | placa ${bus.placa} | ruta ${bus.ruta} | conductor ${bus.conductor}`);
  abrirChat();
});

function abrirChat() {
  const chat = client.Chat();
  chat.on('data', (msg) => {
    const hora = new Date().toLocaleTimeString();
    console.log(`[${hora}] ${msg.remitente}: ${msg.texto}`);
  });
  chat.on('error', (e) => console.error('Chat cerrado:', e.message));
  chat.on('end', () => process.exit(0));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'central> ' });
  rl.prompt();
  rl.on('line', (texto) => {
    if (texto.trim()) {
      chat.write({
        remitente: 'central', bus_id: BUS_ID, texto,
        enviado_en: { seconds: Math.floor(Date.now() / 1000), nanos: 0 },
      });
    }
    rl.prompt();
  });
  rl.on('close', () => chat.end());
}
