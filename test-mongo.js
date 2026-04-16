// test-mongo.js
const mongoose = require('mongoose');

// Conexión directa (sin SRV, con IP del clúster)
const MONGODB_URI = 'mongodb://aniabel:LTHdg2qu9PPX83MR@cluster0.2bvyjwp.mongodb.net/watertank?retryWrites=true&w=majority&directConnection=true&tls=true&serverSelectionTimeoutMS=5000';

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('✅ Conectado a MongoDB Atlas correctamente');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error de conexión:', err.message);
    process.exit(1);
  });