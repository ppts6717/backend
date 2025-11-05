const rideService = require('../services/ride.service');
const { validationResult } = require('express-validator');
const mapService = require('../services/maps.service');
const { sendMessageToSocketId } = require('../socket');
const rideModel = require('../models/ride.model');


// 🟢 Create a new ride request (for User)
module.exports.createRide = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { pickup, destination, vehicleType, rideType, availableSeats, genderPreference } = req.body;

  try {
    console.log("🚕 Creating a new ride request...");
    console.log("User ID:", req.user._id);

    const ride = await rideService.createRide({
      user: req.user._id,
      pickup,
      destination,
      vehicleType,
      rideType,
      availableSeats,
      genderPreference
    });

    // Respond to frontend first
    res.status(201).json(ride);

    // Get pickup coordinates
    const pickupCoordinates = await mapService.getAddressCoordinate(pickup);

    // Find nearby captains (20 km radius)
    const captainsInRadius = await mapService.getCaptainsInTheRadius(
      pickupCoordinates.ltd,
      pickupCoordinates.lng,
      20000
    );

    const rideWithUser = await rideModel.findOne({ _id: ride._id }).populate('user');

    // Send real-time notification to each captain
    captainsInRadius.forEach((captain) => {
      if (captain.socketId) {
        console.log(`📡 Sending ride request to Captain (${captain.name}) - Socket: ${captain.socketId}`);
        sendMessageToSocketId(captain.socketId, {
          event: 'new-ride',
          data: rideWithUser
        });
      } else {
        console.warn(`⚠️ Captain ${captain.name} has no active socket connection`);
      }
    });

  } catch (err) {
    console.error('❌ Error in createRide:', err);
    return res.status(500).json({ message: err.message });
  }
};


// 🟢 Get normal ride fare
module.exports.getFare = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

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
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

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
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { rideId } = req.body;

  try {
    const ride = await rideService.confirmRide({ rideId, captain: req.captain });

    if (ride.user?.socketId) {
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


// 🟢 Captain starts the ride
module.exports.startRide = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { rideId, otp } = req.query;

  try {
    const ride = await rideService.startRide({ rideId, otp, captain: req.captain });

    if (ride.user?.socketId) {
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


// 🟢 Captain ends the ride
module.exports.endRide = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { rideId } = req.body;

  try {
    const ride = await rideService.endRide({ rideId, captain: req.captain });

    if (ride.user?.socketId) {
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
