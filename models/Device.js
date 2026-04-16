const mongoose = require('mongoose');

const DeviceSchema = new mongoose.Schema({
  deviceId: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    default: 'Mi Tanque'
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  tankHeight: {
    type: Number,
    default: 100
  },
  minLevel: {
    type: Number,
    default: 20
  },
  maxLevel: {
    type: Number,
    default: 80
  },
  currentStatus: {
    level: { type: Number, default: 0 },
    distance: { type: Number, default: 0 },
    pumpStatus: { type: Boolean, default: false },
    lastUpdate: { type: Date, default: Date.now }
  },
  readings: [{
    level: Number,
    distance: Number,
    pumpStatus: Boolean,
    timestamp: { type: Date, default: Date.now }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Device', DeviceSchema);