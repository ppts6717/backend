const mongoose = require('mongoose');

const carpoolSchema = new mongoose.Schema({
  driver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  genderPreference: {
    type: String,
    enum: ['male', 'female', 'any'],
    default: 'any'
  },
  maxPassengers: {
    type: Number,
    required: true,
    min: [1, 'At least 1 passenger is required']
  },
  totalAmount: {
    type: Number,
    required: true,
    min: [0, 'Total amount must be non-negative']
  },
  passengers: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  ],
  status: {
    type: String,
    enum: ['active', 'cancelled', 'completed'],
    default: 'active'
  }
}, {
  timestamps: true // Optional: adds createdAt and updatedAt fields
});

module.exports = mongoose.model('Carpool', carpoolSchema);
