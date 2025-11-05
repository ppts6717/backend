const rideService = require('../services/ride.service');
const { validationResult } = require('express-validator');
const mapService = require('../services/maps.service');
const { sendMessageToSocketId } = require('../socket');
const rideModel = require('../models/ride.model');

// 🟢 Create a new ride request (User)
module.exports.createRide = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { pickup, destination, vehicleType, rideType, availableSeats, genderPreference } = req.body;

  try {
    console.log('🚕 Creating a new ride request for user:', req.user._id);

    const ride = await rideService.createRide({
      user: req.user._id,
      pickup,
      destination,
      vehicleType,
      rideType,
      availableSeats,
      genderPreference
    });

    // ✅ Respond to frontend immediately
    res.status(201).json(ride);

    // ✅ Get pickup coordinates
    const pickupCoordinates = await mapService.getAddressCoordinate(pickup);

    // ✅ Find nearby captains (within 20 km radius)
    const captainsInRadius = await mapService.getCaptainsInTheRadius(
      pickupCoordinates.ltd,
      pickupCoordinates.lng,
      20000
    );

    // ✅ Populate user for full ride details
    const rideWithUser = await rideModel.findById(ride._id).populate('user');

    if (!captainsInRadius?.length) {
      console.warn('⚠️ No captains found in 20km radius.');
      return;
    }

    // ✅ Send ride notification to each nearby captain
    captainsInRadius.forEach((captain) => {
      if (captain.socketId) {
        console.log(`📡 Notifying Captain ${captain.name} (${captain._id}) via socket ${captain.socketId}`);
        sendMessageToSocketId(captain.socketId, {
          event: 'new-ride',
          data: rideWithUser
        });
      } else {
        console.warn(`⚠️ Captain ${captain.name} (${captain._id}) has no active socket connection.`);
      }
    });
  } catch (err) {
    console.error('❌ Error in createRide:', err);
    return res.status(500).json({ message: err.message || 'Internal server error' });
  }
};

// 🟢 Get normal ride fare
module.exports.getFare = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { pickup, destination } = req.query;

  try {
    const fare = await rideService.getFare(pickup, destination);
    return res.status(200).json(fare);
  } catch (err) {
    console.error('❌ Error getting fare:', err);
    return res.status(500).json({ message: err.message });
  }
};

// 🟢 Get carpool fare
module.exports.calculateCarpoolFare = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { pickup, destination, availableSeats, rideType } = req.query;

  try {
    const fareDetails = await rideService.calculateCarpoolFare(
      pickup,
      destination,
      availableSeats,
      rideType
    );
    return res.status(200).json(fareDetails);
  } catch (err) {
    console.error('❌ Error calculating carpool fare:', err);
    return res.status(500).json({ message: err.message });
  }
};

// 🟢 Captain confirms a ride
module.exports.confirmRide = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { rideId } = req.body;

  try {
    const ride = await rideService.confirmRide({ rideId, captain: req.captain });

    if (ride.user?.socketId) {
      console.log(`✅ Sending ride-confirmed event to user socket ${ride.user.socketId}`);
      sendMessageToSocketId(ride.user.socketId, {
        event: 'ride-confirmed',
        data: ride
      });
    }

    return res.status(200).json(ride);
  } catch (err) {
    console.error('❌ Error in confirmRide:', err);
    return res.status(500).json({ message: err.message });
  }
};

// 🟢 Captain starts ride
module.exports.startRide = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { rideId, otp } = req.query;

  try {
    const ride = await rideService.startRide({ rideId, otp, captain: req.captain });

    if (ride.user?.socketId) {
      console.log(`✅ Sending ride-started event to user socket ${ride.user.socketId}`);
      sendMessageToSocketId(ride.user.socketId, {
        event: 'ride-started',
        data: ride
      });
    }

    return res.status(200).json(ride);
  } catch (err) {
    console.error('❌ Error in startRide:', err);
    return res.status(500).json({ message: err.message });
  }
};

// 🟢 Captain ends ride
module.exports.endRide = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { rideId } = req.body;

  try {
    const ride = await rideService.endRide({ rideId, captain: req.captain });

    if (ride.user?.socketId) {
      console.log(`✅ Sending ride-ended event to user socket ${ride.user.socketId}`);
      sendMessageToSocketId(ride.user.socketId, {
        event: 'ride-ended',
        data: ride
      });
    }

    return res.status(200).json(ride);
  } catch (err) {
    console.error('❌ Error in endRide:', err);
    return res.status(500).json({ message: err.message });
  }
};
