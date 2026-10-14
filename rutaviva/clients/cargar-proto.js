const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

// Carga el contrato y crea el cliente tipado del servicio FlotaService.
// API_HOST es la URL pública (p. ej. rutaviva-api-xxxxx.run.app:443) o localhost:50051.
function crearCliente() {
  const def = protoLoader.loadSync(path.join(__dirname, '..', 'proto', 'rutaviva.proto'), {
    keepCase: true, longs: String, enums: String, defaults: true,
  });
  const { FlotaService } = grpc.loadPackageDefinition(def).rutaviva.v1;
  const host = process.env.API_HOST || 'localhost:50051';
  // Cloud Run termina TLS; en local se usa INSECURE=1
  const credenciales = process.env.INSECURE === '1'
    ? grpc.credentials.createInsecure()
    : grpc.credentials.createSsl();
  return new FlotaService(host, credenciales);
}

module.exports = { crearCliente };
