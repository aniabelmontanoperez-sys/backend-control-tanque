// index.js - Punto de entrada para Railway
// Este archivo redirige a server.js
// index.js - Punto de entrada para Railway

const { exec } = require('child_process');

console.log('🚀 Iniciando servidor desde index.js...');
console.log('📡 Redirigiendo a server.js');

// Ejecutar server.js
require('./server.js');