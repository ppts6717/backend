const express = require('express');
const router = express.Router();
const Carpool = require('../models/carpool.model');
const User = require('../models/user.model');

// ✅ Create or Reject based on current ride status
router.post('/create', async (req, res) => {
  const { driver, genderPreference, maxPassengers, totalAmount } = req.body;

  const existing = await Carpool.findOne({ driver });

  if (existing) {
    if (existing.status === 'active') {
      return res.status(400).json({ message: 'Driver already has an active carpool. Complete it first.' });
    }

    if (existing.status === 'completed') {
      // Optional: keep as history
    }

    // Overwrite if status is cancelled
    existing.genderPreference = genderPreference;
    existing.maxPassengers = maxPassengers;
    existing.totalAmount = totalAmount;
    existing.passengers = [];
    existing.status = 'active';
    await existing.save();
    return res.status(201).json(existing);
  }

  // No existing carpool, create new
  const carpool = new Carpool({
    driver,
    genderPreference,
    maxPassengers,
    totalAmount,
    passengers: [],
    status: 'active'
  });

  await carpool.save();
  res.status(201).json(carpool);
});

// ✅ Join carpool
router.post('/:carpoolId/join', async (req, res) => {
  const { carpoolId } = req.params;
  const { userId } = req.body;

  const carpool = await Carpool.findById(carpoolId);
  const user = await User.findById(userId);

  if (!carpool || !user) return res.status(404).json({ message: 'Carpool or user not found' });
  if (carpool.status !== 'active') return res.status(400).json({ message: 'Carpool is not active' });

  if (carpool.genderPreference !== 'any' && carpool.genderPreference !== user.gender) {
    return res.status(403).json({ message: 'Gender not allowed' });
  }

  if (carpool.passengers.includes(userId)) {
    return res.status(400).json({ message: 'User already joined' });
  }

  if (carpool.passengers.length >= carpool.maxPassengers) {
    return res.status(400).json({ message: 'Carpool is full' });
  }

  carpool.passengers.push(userId);
  await carpool.save();

  const payingPassengers = carpool.passengers.length;
  const perPersonAmount = (carpool.totalAmount / payingPassengers).toFixed(2);

  res.json({
    message: 'Joined carpool',
    perPersonAmount,
    totalPassengers: payingPassengers
  });
});

// ✅ Cancel carpool — only allowed if not started (i.e., 0 passengers)
router.post('/:carpoolId/cancel', async (req, res) => {
  const { carpoolId } = req.params;
  const carpool = await Carpool.findById(carpoolId);

  if (!carpool) return res.status(404).json({ message: 'Carpool not found' });

  if (carpool.status !== 'active') {
    return res.status(400).json({ message: 'Only active carpools can be cancelled' });
  }

  if (carpool.passengers.length > 0) {
    return res.status(403).json({ message: 'Cannot cancel ride after passengers have joined' });
  }

  carpool.status = 'cancelled';
  await carpool.save();
  res.json({ message: 'Carpool cancelled' });
});

// ✅ Complete carpool
router.post('/:carpoolId/complete', async (req, res) => {
  const { carpoolId } = req.params;
  const carpool = await Carpool.findById(carpoolId);

  if (!carpool) return res.status(404).json({ message: 'Carpool not found' });

  carpool.status = 'completed';
  await carpool.save();
  res.json({ message: 'Carpool completed' });
});

// ✅ List all carpools
router.get('/', async (req, res) => {
  const carpools = await Carpool.find()
    .populate('driver', 'name gender')
    .populate('passengers', 'name gender');
  res.json(carpools);
});

module.exports = router;
