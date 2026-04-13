// server.js - Sistema de Control de Tanque
// Versión para despliegue en la nube (Render, Railway, etc.)
// Con altura configurable y porcentaje
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']); // Fuerza el uso de DNS de Google y Cloudflare

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Configuración de CORS para permitir conexiones desde tu frontend en Netlify
// Reemplaza con la URL de tu frontend cuando la tengas
const allowedOrigins = [
  'http://localhost:3000',           // Desarrollo local
  'https://control-nivel-tanque.netlify.app', // <--- CAMBIA ESTO por tu URL de Netlify
  process.env.FRONTEND_URL           // Opcional: usar variable de entorno
];

const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(express.json());

// Puerto para la nube (Render asigna process.env.PORT automáticamente)
const PORT = process.env.PORT || 3001;

// Esquema de MongoDB
const TankDataSchema = new mongoose.Schema({
  level: Number,        // Porcentaje (0-100)
  distance: Number,     // Distancia medida por sensor (cm)
  pumpStatus: Boolean,
  timestamp: { type: Date, default: Date.now }
});
const TankData = mongoose.model('TankData', TankDataSchema);

// Estado actual del sistema
let currentStatus = {
  level: 0,
  distance: 0,
  pumpStatus: false,
  minLevel: 20,        // % mínimo para encender bomba
  maxLevel: 80,        // % máximo para apagar bomba
  tankHeight: 100      // Altura del tanque en cm (configurable)
};

// Conectar a MongoDB (usar variable de entorno en la nube)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/watertank';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ Conectado a MongoDB'))
  .catch(err => console.log('⚠️ MongoDB no disponible:', err.message));

// ==================== TELEGRAM BOT ====================
const { Telegraf } = require('telegraf');
let bot = null;

if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN !== '') {
  bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
  bot.launch();
  console.log('🤖 Bot de Telegram iniciado');
  
  bot.command('start', (ctx) => {
    ctx.reply('🤖 Bienvenido al Sistema de Control de Tanque\n\n' +
      'Comandos disponibles:\n' +
      '/status - Ver estado actual\n' +
      '/history - Ver últimas 5 lecturas\n' +
      '/help - Ver ayuda');
  });
  
  bot.command('status', async (ctx) => {
    ctx.reply(`📊 Estado Actual:\n\n` +
      `💧 Nivel: ${Math.round(currentStatus.level)} %\n` +
      `📏 Altura tanque: ${currentStatus.tankHeight} cm\n` +
      `🔄 Bomba: ${currentStatus.pumpStatus ? 'ENCENDIDA' : 'APAGADA'}\n` +
      `⬇️ Mínimo: ${currentStatus.minLevel} %\n` +
      `⬆️ Máximo: ${currentStatus.maxLevel} %`);
  });
  
  bot.command('history', async (ctx) => {
    try {
      const history = await TankData.find().sort({ timestamp: -1 }).limit(5);
      let message = '📈 Últimas 5 lecturas:\n\n';
      history.forEach(reading => {
        const time = new Date(reading.timestamp).toLocaleTimeString();
        message += `${time}: ${Math.round(reading.level)}% (Bomba: ${reading.pumpStatus ? 'ON' : 'OFF'})\n`;
      });
      ctx.reply(message);
    } catch (err) {
      ctx.reply('Error al obtener historial');
    }
  });
  
  bot.command('help', (ctx) => {
    ctx.reply('📋 Comandos disponibles:\n\n' +
      '/status - Ver estado actual del tanque\n' +
      '/history - Ver últimas 5 lecturas\n' +
      '/help - Mostrar esta ayuda');
  });
  
  console.log('✅ Comandos de Telegram disponibles: /status, /history, /help');
} else {
  console.log('⚠️ Telegram no configurado. Agrega TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID en .env');
}

// ==================== FUNCIONES AUXILIARES ====================

// Convierte distancia medida (cm) a porcentaje de llenado
function distanceToPercentage(distanceCm, tankHeightCm) {
  if (distanceCm < 0) distanceCm = 0;
  if (distanceCm > tankHeightCm) distanceCm = tankHeightCm;
  const levelCm = tankHeightCm - distanceCm;
  const percentage = (levelCm / tankHeightCm) * 100;
  return Math.min(100, Math.max(0, percentage));
}

// Enviar alerta por Telegram
async function sendTelegramAlert(message) {
  if (bot && process.env.TELEGRAM_CHAT_ID) {
    try {
      await bot.telegram.sendMessage(process.env.TELEGRAM_CHAT_ID, message);
    } catch (err) {
      console.error('Error enviando alerta:', err.message);
    }
  }
}

// ==================== API ENDPOINTS ====================

// Endpoint para recibir datos del ESP8266 (distancia en cm)
app.post('/api/data', async (req, res) => {
  const { distance, pumpStatus } = req.body;
  
  if (distance === undefined) {
    return res.status(400).json({ error: 'Distancia requerida' });
  }
  
  // Calcular nivel en porcentaje usando la altura configurada
  const level = distanceToPercentage(distance, currentStatus.tankHeight);
  
  // Actualizar estado
  currentStatus.level = level;
  currentStatus.distance = distance;
  if (pumpStatus !== undefined) currentStatus.pumpStatus = pumpStatus;
  
  // Control automático de bomba
  let newPumpStatus = currentStatus.pumpStatus;
  if (level <= currentStatus.minLevel && !currentStatus.pumpStatus) {
    newPumpStatus = true;
    currentStatus.pumpStatus = true;
  } else if (level >= currentStatus.maxLevel && currentStatus.pumpStatus) {
    newPumpStatus = false;
    currentStatus.pumpStatus = false;
  }
  
  // Guardar en MongoDB
  try {
    await TankData.create({
      level: level,
      distance: distance,
      pumpStatus: newPumpStatus
    });
    console.log(`📊 Datos guardados: ${Math.round(level)}% (distancia: ${distance}cm)`);
  } catch (err) {
    console.error('Error guardando:', err);
  }
  
  // Enviar alertas por Telegram
  if (level <= 15) {
    await sendTelegramAlert(
      `🔴 ALARMA CRÍTICA: Nivel de agua MUY BAJO!\n\n` +
      `📊 Nivel: ${Math.round(level)}%\n` +
      `📏 Altura tanque: ${currentStatus.tankHeight} cm\n` +
      `🔄 Bomba: ${newPumpStatus ? 'ENCENDIDA' : 'APAGADA'}`
    );
  } else if (level >= 90) {
    await sendTelegramAlert(
      `🔴 ALARMA CRÍTICA: Tanque casi lleno!\n\n` +
      `📊 Nivel: ${Math.round(level)}%\n` +
      `📏 Altura tanque: ${currentStatus.tankHeight} cm\n` +
      `🔄 Bomba: ${newPumpStatus ? 'ENCENDIDA' : 'APAGADA'}`
    );
  } else if (level <= currentStatus.minLevel && newPumpStatus) {
    await sendTelegramAlert(
      `⚠️ Nivel bajo: ${Math.round(level)}%\n🔛 Bomba ENCENDIDA automáticamente`
    );
  } else if (level >= currentStatus.maxLevel && !newPumpStatus) {
    await sendTelegramAlert(
      `✅ Nivel alto: ${Math.round(level)}%\n🔴 Bomba APAGADA automáticamente`
    );
  }
  
  // Emitir actualización por WebSocket
  io.emit('status_update', currentStatus);
  
  res.json({ success: true, level: Math.round(level) });
});

// Endpoint para obtener estado actual
app.get('/api/status', (req, res) => {
  res.json(currentStatus);
});

// Endpoint para obtener historial
app.get('/api/history', async (req, res) => {
  try {
    const history = await TankData.find().sort({ timestamp: -1 }).limit(100);
    res.json(history);
  } catch (err) {
    res.json([]);
  }
});

// Endpoint para configurar parámetros (umbrales y altura)
app.post('/api/config', (req, res) => {
  const { minLevel, maxLevel, tankHeight } = req.body;
  
  if (minLevel !== undefined && minLevel >= 0 && minLevel <= 100) {
    currentStatus.minLevel = minLevel;
  }
  if (maxLevel !== undefined && maxLevel >= 0 && maxLevel <= 100) {
    currentStatus.maxLevel = maxLevel;
  }
  if (tankHeight !== undefined && tankHeight > 0 && tankHeight <= 500) {
    currentStatus.tankHeight = tankHeight;
  }
  
  console.log('⚙️ Configuración actualizada:', {
    minLevel: currentStatus.minLevel,
    maxLevel: currentStatus.maxLevel,
    tankHeight: currentStatus.tankHeight
  });
  
  res.json({ success: true, ...currentStatus });
});

// Endpoint para simular datos (para pruebas sin hardware)
app.post('/api/simulate', async (req, res) => {
  const { level } = req.body; // level es porcentaje (0-100)
  
  if (level !== undefined && level >= 0 && level <= 100) {
    currentStatus.level = level;
    
    // Control automático de bomba
    if (level <= currentStatus.minLevel && !currentStatus.pumpStatus) {
      currentStatus.pumpStatus = true;
    } else if (level >= currentStatus.maxLevel && currentStatus.pumpStatus) {
      currentStatus.pumpStatus = false;
    }
    
    // Calcular distancia simulada para guardar
    const simulatedDistance = currentStatus.tankHeight * (1 - level / 100);
    
    // Guardar simulación en MongoDB
    try {
      await TankData.create({
        level: level,
        distance: simulatedDistance,
        pumpStatus: currentStatus.pumpStatus
      });
      console.log(`🎲 Simulación: ${Math.round(level)}% (distancia simulada: ${simulatedDistance.toFixed(1)}cm)`);
    } catch (err) {
      console.error('Error guardando simulación:', err);
    }
    
    // Emitir actualización
    io.emit('status_update', currentStatus);
    res.json({ success: true, level: Math.round(level) });
  } else {
    res.status(400).json({ error: 'Level requerido (0-100)' });
  }
});

// ==================== WEBSOCKET ====================
io.on('connection', (socket) => {
  console.log('📱 Cliente conectado');
  socket.emit('status_update', currentStatus);
});

// ==================== INICIAR SERVIDOR ====================
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║  🚀 SISTEMA DE CONTROL DE TANQUE                              ║
╠═══════════════════════════════════════════════════════════════╣
║  📡 Servidor: http://localhost:${PORT}                         ║
║  📊 API Status: http://localhost:${PORT}/api/status            ║
║  💾 MongoDB: ${MONGODB_URI.includes('localhost') ? 'Local' : 'Atlas'}            ║
║  📏 Altura tanque: ${currentStatus.tankHeight} cm              ║
║  🎯 Umbrales: ${currentStatus.minLevel}% - ${currentStatus.maxLevel}%             ║
║  🤖 Telegram: ${bot ? 'Activo' : 'No configurado'}                             ║
║  🌐 CORS permitido para: ${allowedOrigins.join(', ')}          ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});