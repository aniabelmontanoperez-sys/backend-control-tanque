// index.js - Sistema de Control de Tanque
// Versión con autenticación JWT y creación automática de dispositivos

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

// ==================== IMPORTACIONES PARA AUTENTICACIÓN ====================
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const Device = require('./models/Device');
const auth = require('./middleware/auth');

const app = express();
const server = http.createServer(app);

// ==================== CONFIGURACIÓN DE CORS ====================
const allowedOrigins = [
  'http://localhost:3000',
  'https://sistema-nivel-agua.github.io',
  process.env.FRONTEND_URL
].filter(Boolean);

const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(express.json());

// ==================== VARIABLES DE ENTORNO ====================
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'mi_secreto_super_seguro_para_tesis_2024';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/watertank';

// ==================== MODELO DE DATOS (legacy) ====================
const TankDataSchema = new mongoose.Schema({
  level: Number,
  distance: Number,
  pumpStatus: Boolean,
  timestamp: { type: Date, default: Date.now }
});
const TankData = mongoose.model('TankData', TankDataSchema);

// ==================== CONEXIÓN A MONGODB ====================
mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ Conectado a MongoDB'))
  .catch(err => console.log('⚠️ MongoDB no disponible:', err.message));

// ==================== TELEGRAM BOT ====================
const { Telegraf } = require('telegraf');
let bot = null;

if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN !== '') {
  bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
  bot.launch().catch(err => console.log('Error al lanzar bot:', err.message));
  console.log('🤖 Bot de Telegram iniciado');
  
  bot.command('start', (ctx) => {
    ctx.reply('🤖 Bienvenido al Sistema de Control de Tanque\n\n' +
      'Comandos disponibles:\n' +
      '/status - Ver estado de tus dispositivos\n' +
      '/help - Ver ayuda\n\n' +
      'Para vincular tu cuenta, inicia sesión en la página web y ve a Configuración.');
  });
  
  bot.command('status', async (ctx) => {
    const user = await User.findOne({ telegramChatId: ctx.chat.id.toString() });
    if (!user) {
      return ctx.reply('❌ No estás registrado. Vincula tu cuenta desde la página web.');
    }
    
    const devices = await Device.find({ userId: user._id });
    if (devices.length === 0) {
      return ctx.reply('📟 No tienes dispositivos registrados.');
    }
    
    let message = '📊 *Estado de tus dispositivos:*\n\n';
    for (const device of devices) {
      message += `📟 *${device.name}*\n`;
      message += `💧 Nivel: ${Math.round(device.currentStatus.level)}%\n`;
      message += `🔄 Bomba: ${device.currentStatus.pumpStatus ? 'ENCENDIDA' : 'APAGADA'}\n`;
      message += `⬇️ Mínimo: ${device.minLevel}%\n`;
      message += `⬆️ Máximo: ${device.maxLevel}%\n\n`;
    }
    ctx.reply(message, { parse_mode: 'Markdown' });
  });
  
  bot.command('help', (ctx) => {
    ctx.reply('📋 *Comandos disponibles:*\n\n' +
      '/status - Ver estado de tus dispositivos\n' +
      '/help - Mostrar esta ayuda\n\n' +
      'Para vincular tu cuenta, inicia sesión en la página web y ve a Configuración.',
      { parse_mode: 'Markdown' });
  });
  
  console.log('✅ Comandos de Telegram disponibles');
} else {
  console.log('⚠️ Telegram no configurado');
}

// ==================== FUNCIONES AUXILIARES ====================
function distanceToPercentage(distanceCm, tankHeightCm) {
  if (distanceCm < 0) distanceCm = 0;
  if (distanceCm > tankHeightCm) distanceCm = tankHeightCm;
  const levelCm = tankHeightCm - distanceCm;
  const percentage = (levelCm / tankHeightCm) * 100;
  return Math.min(100, Math.max(0, percentage));
}

// ==================== ENDPOINTS DE AUTENTICACIÓN ====================

// Registrar nuevo usuario
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;

  try {
    let user = await User.findOne({ $or: [{ email }, { username }] });
    if (user) {
      return res.status(400).json({ error: 'El usuario o email ya existe' });
    }

    user = new User({ username, email, password });
    await user.save();

    const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, {
      expiresIn: '7d'
    });

    res.json({
      token,
      user: { id: user._id, username: user.username, email: user.email }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// Iniciar sesión
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ error: 'Usuario o contraseña incorrectos' });
    }

    const isValid = await user.comparePassword(password);
    if (!isValid) {
      return res.status(400).json({ error: 'Usuario o contraseña incorrectos' });
    }

    const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, {
      expiresIn: '7d'
    });

    res.json({
      token,
      user: { id: user._id, username: user.username, email: user.email }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// Obtener información del usuario autenticado
app.get('/api/auth/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password').populate('devices');
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// Vincular cuenta de Telegram
app.post('/api/auth/telegram', auth, async (req, res) => {
  const { chatId } = req.body;
  
  try {
    await User.findByIdAndUpdate(req.user.id, { telegramChatId: chatId });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al vincular Telegram' });
  }
});

// ==================== ENDPOINTS DE DISPOSITIVOS ====================

// Registrar un nuevo dispositivo (manual)
app.post('/api/devices/register', auth, async (req, res) => {
  const { deviceId, name } = req.body;

  try {
    let device = await Device.findOne({ deviceId });
    if (device) {
      return res.status(400).json({ error: 'El dispositivo ya está registrado' });
    }

    device = new Device({
      deviceId,
      name: name || 'Mi Tanque',
      userId: req.user.id
    });

    await device.save();
    await User.findByIdAndUpdate(req.user.id, { $push: { devices: device._id } });

    res.json({ success: true, device });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// Obtener todos los dispositivos del usuario
app.get('/api/devices', auth, async (req, res) => {
  try {
    const devices = await Device.find({ userId: req.user.id });
    res.json(devices);
  } catch (error) {
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// Obtener estado de un dispositivo específico
app.get('/api/status/:deviceId', auth, async (req, res) => {
  try {
    const device = await Device.findOne({ 
      deviceId: req.params.deviceId,
      userId: req.user.id 
    });
    
    if (!device) {
      return res.status(404).json({ error: 'Dispositivo no encontrado' });
    }

    res.json(device.currentStatus);
  } catch (error) {
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// Configurar parámetros de un dispositivo
app.post('/api/config', auth, async (req, res) => {
  const { deviceId, minLevel, maxLevel, tankHeight } = req.body;

  try {
    const device = await Device.findOne({ 
      deviceId: deviceId,
      userId: req.user.id 
    });
    
    if (!device) {
      return res.status(404).json({ error: 'Dispositivo no encontrado' });
    }

    if (minLevel !== undefined) device.minLevel = minLevel;
    if (maxLevel !== undefined) device.maxLevel = maxLevel;
    if (tankHeight !== undefined && tankHeight > 0) device.tankHeight = tankHeight;

    await device.save();

    res.json({ 
      success: true, 
      minLevel: device.minLevel, 
      maxLevel: device.maxLevel, 
      tankHeight: device.tankHeight 
    });
  } catch (error) {
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// Obtener historial de un dispositivo
app.get('/api/history/:deviceId', auth, async (req, res) => {
  try {
    const device = await Device.findOne({ 
      deviceId: req.params.deviceId,
      userId: req.user.id 
    });
    
    if (!device) {
      return res.status(404).json({ error: 'Dispositivo no encontrado' });
    }

    const history = device.readings.slice(-100).reverse();
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// ==================== ENDPOINT PARA ESP8266 (con creación automática) ====================

app.post('/api/data', async (req, res) => {
  const { deviceId, distance, pumpStatus } = req.body;

  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId requerido' });
  }

  if (distance === undefined) {
    return res.status(400).json({ error: 'Distancia requerida' });
  }

  try {
    // Buscar el dispositivo
    let device = await Device.findOne({ deviceId });
    
    // Si no existe, lo creamos automáticamente
    if (!device) {
      console.log(`📟 Nuevo dispositivo detectado: ${deviceId}. Creando automáticamente...`);
      
      // Buscar el primer usuario registrado (o el que tenga dispositivos)
      let defaultUser = await User.findOne();
      
      // Si no hay usuarios, crear uno por defecto (solo para desarrollo)
      if (!defaultUser) {
        console.log('⚠️ No hay usuarios registrados. Creando usuario por defecto...');
        defaultUser = new User({
          username: 'admin',
          email: 'admin@example.com',
          password: 'admin123'
        });
        await defaultUser.save();
        console.log('✅ Usuario admin creado con contraseña: admin123');
      }
      
      device = new Device({
        deviceId: deviceId,
        name: `Tanque_${deviceId.slice(-6)}`,
        userId: defaultUser._id,
        tankHeight: 100,
        minLevel: 20,
        maxLevel: 80,
        currentStatus: {
          level: 0,
          distance: 0,
          pumpStatus: false,
          lastUpdate: new Date()
        },
        readings: []
      });
      
      await device.save();
      await User.findByIdAndUpdate(defaultUser._id, { $push: { devices: device._id } });
      console.log(`✅ Dispositivo ${deviceId} creado automáticamente para usuario ${defaultUser.username}`);
    }

    // Calcular nivel usando la altura del tanque del dispositivo
    const level = distanceToPercentage(distance, device.tankHeight);

    // Control automático de bomba
    let newPumpStatus = pumpStatus !== undefined ? pumpStatus : device.currentStatus.pumpStatus;
    
    if (level <= device.minLevel && !newPumpStatus) {
      newPumpStatus = true;
    } else if (level >= device.maxLevel && newPumpStatus) {
      newPumpStatus = false;
    }

    // Actualizar estado actual del dispositivo
    device.currentStatus = {
      level,
      distance,
      pumpStatus: newPumpStatus,
      lastUpdate: new Date()
    };

    // Guardar lectura en el historial
    device.readings.push({
      level,
      distance,
      pumpStatus: newPumpStatus,
      timestamp: new Date()
    });

    // Limitar historial a 500 lecturas
    if (device.readings.length > 500) {
      device.readings = device.readings.slice(-500);
    }

    await device.save();

    // Guardar también en colección legacy por compatibilidad
    await TankData.create({
      level: level,
      distance: distance,
      pumpStatus: newPumpStatus
    });

    // Emitir actualización por WebSocket para este dispositivo
    io.emit(`status_update_${deviceId}`, device.currentStatus);

    // Enviar alertas por Telegram
    const user = await User.findById(device.userId);
    if (user && user.telegramChatId && bot) {
      if (level <= 15) {
        await bot.telegram.sendMessage(user.telegramChatId,
          `🔴 ALARMA CRÍTICA: Nivel de agua MUY BAJO!\n\n` +
          `📊 Dispositivo: ${device.name}\n` +
          `📊 Nivel actual: ${Math.round(level)}%\n` +
          `🔄 Bomba: ${newPumpStatus ? 'ENCENDIDA' : 'APAGADA'}\n` +
          `⚠️ Riesgo de bomba seca. Revisa el sistema.`
        );
      } else if (level >= 90) {
        await bot.telegram.sendMessage(user.telegramChatId,
          `🔴 ALARMA CRÍTICA: Tanque casi lleno!\n\n` +
          `📊 Dispositivo: ${device.name}\n` +
          `📊 Nivel actual: ${Math.round(level)}%\n` +
          `🔄 Bomba: ${newPumpStatus ? 'ENCENDIDA' : 'APAGADA'}\n` +
          `⚠️ Riesgo de desbordamiento. Revisa el sistema.`
        );
      }
    }

    res.json({ success: true, level: Math.round(level) });

  } catch (error) {
    console.error('Error en /api/data:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ==================== ENDPOINTS LEGACY (compatibilidad) ====================
app.get('/api/status', (req, res) => {
  res.json({ message: 'Usa /api/status/:deviceId con autenticación' });
});

app.get('/api/history', async (req, res) => {
  try {
    const history = await TankData.find().sort({ timestamp: -1 }).limit(100);
    res.json(history);
  } catch (err) {
    res.json([]);
  }
});

app.post('/api/simulate', async (req, res) => {
  const { level, deviceId } = req.body;
  
  if (level !== undefined && level >= 0 && level <= 100) {
    const simulatedDistance = 100 * (1 - level / 100);
    await TankData.create({
      level: level,
      distance: simulatedDistance,
      pumpStatus: level <= 20
    });
    
    io.emit('status_update', { level, pumpStatus: level <= 20 });
    res.json({ success: true, level });
  } else {
    res.status(400).json({ error: 'Level requerido (0-100)' });
  }
});

// ==================== ENDPOINTS PARA VERIFICACIÓN DE BOMBA ====================

// Endpoint para recibir confirmación de bomba
app.post('/api/bomba-status', async (req, res) => {
  const { deviceId, funciono, nivelAntes, nivelDespues } = req.body;
  
  console.log(`📟 Dispositivo ${deviceId}: Bomba ${funciono ? 'funcionó ✅' : 'falló ❌'}`);
  if (nivelAntes && nivelDespues) {
    console.log(`   Nivel antes: ${nivelAntes}% → Nivel después: ${nivelDespues}%`);
  }
  
  res.json({ success: true });
});

// Endpoint para recibir alerta de fallo de bomba
app.post('/api/alerta-fallo-bomba', async (req, res) => {
  const { deviceId, mensaje, nivelActual } = req.body;
  
  console.log(`🚨 ALERTA: ${mensaje}`);
  console.log(`   Dispositivo: ${deviceId}`);
  console.log(`   Nivel actual: ${nivelActual}%`);
  
  // Buscar el dispositivo y su usuario
  const device = await Device.findOne({ deviceId });
  if (device) {
    const user = await User.findById(device.userId);
    if (user && user.telegramChatId && bot) {
      await bot.telegram.sendMessage(user.telegramChatId,
        `🚨 *ALERTA DE FALLO EN BOMBA*\n\n` +
        `📟 Dispositivo: ${device.name}\n` +
        `⚠️ Problema: La bomba no encendió correctamente\n` +
        `📊 Nivel actual: ${Math.round(nivelActual)}%\n\n` +
        `*Posibles causas:*\n` +
        `• Bomba averiada\n` +
        `• Relé defectuoso\n` +
        `• Sin suministro eléctrico\n` +
        `• Cable suelto`,
        { parse_mode: 'Markdown' }
      );
      console.log(`📱 Alerta enviada a Telegram al usuario ${user.username}`);
    }
  }
  
  res.json({ success: true });
});


// ==================== WEBSOCKET ====================
io.on('connection', (socket) => {
  console.log('📱 Cliente conectado');
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
║  🔐 Autenticación: Activa (JWT)                               ║
║  🤖 Telegram: ${bot ? 'Activo' : 'No configurado'}                             ║
║  📟 Auto-registro de dispositivos: Activo                     ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});