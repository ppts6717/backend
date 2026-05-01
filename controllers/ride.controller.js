const { validationResult } = require('express-validator');
const rideModel = require('../models/ride.model');
const captainModel = require('../models/captain.model');
const mapService = require('../services/maps.service');
const rideService = require('../services/ride.service');
const { isSocketConnected, sendMessageToSocketId } = require('../socket');

const sendRideUpdateToParticipants = (ride) => {
  if (!ride) {
    return;
  }

  const sentSocketIds = new Set();
  const emitToSocket = (socketId, event, data) => {
    if (!socketId || sentSocketIds.has(socketId)) {
      return;
    }

    if (sendMessageToSocketId(socketId, { event, data })) {
      sentSocketIds.add(socketId);
    }
  };

  emitToSocket(ride.captain?.socketId, 'ride-updated', ride);
  emitToSocket(
    ride.user?.socketId,
    'ride-updated',
    rideService.decorateRideForUser(ride, ride.user?._id)
  );

  (ride.passengers || []).forEach((passenger) => {
    emitToSocket(
      passenger?.socketId,
      'ride-updated',
      rideService.decorateRideForUser(ride, passenger?._id)
    );
  });
};

const normalizeEntityId = (value) => value?.toString?.() || String(value || '');

const isPassengerBoardedForRide = (ride, passengerId) => {
  const normalizedPassengerId = normalizeEntityId(passengerId);
  const allocation = Array.isArray(ride?.passengerAllocations)
    ? ride.passengerAllocations.find((entry) =>
        normalizeEntityId(entry?.user?._id || entry?.user) === normalizedPassengerId
      )
    : null;

  return !allocation || rideService.getPassengerBoardingStatus(allocation) !== 'awaiting_pickup';
};

module.exports.createRide = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { pickup, destination, vehicleType, rideType, availableSeats, genderPreference, allowAnyVehicleType } = req.body;
  let createdRideId = null;

  try {
    const ride = await rideService.createRide({
      user: req.user._id,
      pickup,
      destination,
      vehicleType,
      rideType,
      availableSeats,
      genderPreference,
      allowAnyVehicleType
    });
    createdRideId = ride?._id || null;

    const pickupCoordinates = await mapService.getAddressCoordinate(pickup);
    const captainsInRadius = await mapService.getCaptainsInTheRadius(
      pickupCoordinates.ltd,
      pickupCoordinates.lng,
      20000
    );
    const busyCaptainIds = new Set(
      (await rideModel.distinct('captain', {
        captain: { $ne: null },
        status: { $in: ['accepted', 'ongoing'] },
      })).map((captainId) => captainId?.toString()).filter(Boolean)
    );
    const requestedVehicleType = ride.vehicleType || vehicleType;
    const requestedSeatCount = Number(ride.availableSeats || availableSeats || 1);
    const isFlexibleVehicleRequest = Boolean(ride.allowAnyVehicleType);
    const captainMatchesRide = (captain) => {
      if (String(captain?.status || '').trim().toLowerCase() !== 'active') {
        return false;
      }

      if (!captain.socketId || !isSocketConnected(captain.socketId)) {
        return false;
      }

      if (busyCaptainIds.has(captain?._id?.toString())) {
        return false;
      }

      const captainVehicleType = rideService.normalizeCaptainVehicleType(captain?.vehicle?.vehicleType);
      const captainCapacity = rideService.getCaptainVehicleCapacity(captain);

      if (!captainVehicleType) {
        return false;
      }

      if (ride.rideType === 'carpool' && !rideService.isShareableVehicleType(captainVehicleType)) {
        return false;
      }

      if (!isFlexibleVehicleRequest && captainVehicleType !== requestedVehicleType) {
        return false;
      }

      if (ride.rideType === 'carpool' && captainCapacity < requestedSeatCount) {
        return false;
      }

      return true;
    };

    const uniqueCaptains = (captains) => Array.from(
      new Map((captains || []).map((captain) => [ captain._id.toString(), captain ])).values()
    );

    let reachableCaptains = uniqueCaptains((captainsInRadius || []).filter(captainMatchesRide));

    if (!reachableCaptains.length) {
      const onlineCaptains = await captainModel.find({
        status: 'active',
        socketId: { $nin: [ null, '' ] }
      });

      reachableCaptains = uniqueCaptains(onlineCaptains.filter(captainMatchesRide));
    }

    const rideWithUser = await rideModel.findById(ride._id).populate('user');

    const notifiedCaptainIds = reachableCaptains
      .filter((captain) => sendMessageToSocketId(captain.socketId, {
        event: 'new-ride',
        data: rideWithUser,
      }))
      .map((captain) => captain._id);

    const rideUpdate = notifiedCaptainIds.length
      ? {
          requestedCaptains: notifiedCaptainIds,
          rejectedCaptains: [],
        }
      : {
          status: 'rejected',
          requestedCaptains: [],
          rejectedCaptains: [],
        };

    await rideModel.findByIdAndUpdate(ride._id, rideUpdate);

    const updatedRide = await rideModel.findById(ride._id).populate('user');

    res.status(201).json(rideService.decorateRideForUser(updatedRide, req.user._id));

    return;
  } catch (err) {
    if (createdRideId) {
      try {
        await rideModel.findOneAndUpdate(
          {
            _id: createdRideId,
            status: 'pending',
            captain: null
          },
          {
            status: 'rejected',
            requestedCaptains: [],
            rejectedCaptains: []
          }
        );
      } catch (cleanupError) {
        console.error('Error cleaning up failed ride creation:', cleanupError);
      }
    }

    console.error('Error in createRide:', err);
    return res.status(err.statusCode || 500).json({
      message: err.message || 'Internal server error',
      activeRide: err.activeRide || null,
    });
  }
};

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
    console.error('Error getting fare:', err);
    return res.status(err.statusCode || 500).json({
      message: err.message || 'Unable to calculate fare right now'
    });
  }
};

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

    const requestedFare = rideType === 'carpool'
      ? rideService.getStableSharedRouteFareQuote(fareDetails)
      : null;
    const requestedFarePerSeat = rideType === 'carpool'
      ? Math.round((requestedFare / Math.max(1, Number(availableSeats))) * 100) / 100
      : null;

    return res.status(200).json({
      ...fareDetails,
      requestedFarePerSeat,
      requestedFare,
    });
  } catch (err) {
    console.error('Error calculating carpool fare:', err);
    return res.status(err.statusCode || 500).json({
      message: err.message || 'Unable to calculate carpool fare right now'
    });
  }
};

module.exports.getMatchingCarpools = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { pickup, destination, genderPreference = 'any', availableSeats = 1 } = req.query;

  try {
    const carpoolOptions = await rideService.getMatchingCarpools({
      userId: req.user._id,
      pickup,
      destination,
      genderPreference,
      bookedSeats: Number(availableSeats) || 1
    });

    return res.status(200).json(carpoolOptions);
  } catch (err) {
    console.error('Error getting matching carpools:', err);
    return res.status(err.statusCode || 500).json({ message: err.message || 'Internal server error' });
  }
};

module.exports.getActiveRide = async (req, res) => {
  try {
    const activeRide = await rideService.getActiveRideForUser({
      userId: req.user._id,
    });

    return res.status(200).json(activeRide || null);
  } catch (err) {
    console.error('Error getting active ride:', err);
    return res.status(err.statusCode || 500).json({ message: err.message || 'Internal server error' });
  }
};

module.exports.joinCarpoolRide = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { rideId, pickup, destination, bookedSeats } = req.body;

  try {
    const ride = await rideService.joinCarpoolRide({
      rideId,
      userId: req.user._id,
      pickup,
      destination,
      bookedSeats
    });

    sendRideUpdateToParticipants(ride);

    return res.status(200).json(rideService.decorateRideForUser(ride, req.user._id));
  } catch (err) {
    console.error('Error joining carpool ride:', err);
    return res.status(err.statusCode || 500).json({
      message: err.message || 'Internal server error',
      activeRide: err.activeRide || null,
    });
  }
};

module.exports.getRideStatus = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { rideId } = req.query;

  try {
    const ride = await rideModel.findOne({
      _id: rideId,
      $or: [
        { user: req.user._id },
        { passengers: req.user._id }
      ]
    })
      .populate('user')
      .populate('captain')
      .populate('passengers')
      .populate('passengerAllocations.user')
      .select('+otp');

    if (!ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }

    const resolvedRide = await rideService.reconcileRideState(ride);

    if (!resolvedRide) {
      return res.status(404).json({ message: 'Ride not found' });
    }

    return res.status(200).json(rideService.decorateRideForUser(resolvedRide, req.user._id));
  } catch (err) {
    console.error('Error getting ride status:', err);
    return res.status(err.statusCode || 500).json({ message: err.message || 'Internal server error' });
  }
};

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
        data: rideService.decorateRideForUser(ride, ride.user?._id)
      });
    }

    return res.status(200).json(ride);
  } catch (err) {
    console.error('Error in confirmRide:', err);
    return res.status(err.statusCode || 500).json({ message: err.message || 'Internal server error' });
  }
};

module.exports.rejectRide = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { rideId } = req.body;

  try {
    const { ride, allRequestedCaptainsRejected } = await rideService.rejectRide({
      rideId,
      captain: req.captain
    });
    const requestedCaptainIds = (ride.requestedCaptains || []).map((captainId) => captainId.toString());
    const rejectedCaptainIds = (ride.rejectedCaptains || []).map((captainId) => captainId.toString());
    const pendingCaptainIds = requestedCaptainIds.filter((captainId) => !rejectedCaptainIds.includes(captainId));

    let shouldRejectForUser = allRequestedCaptainsRejected;

    if (!shouldRejectForUser && pendingCaptainIds.length > 0) {
      const pendingCaptains = await captainModel.find({ _id: { $in: pendingCaptainIds } });
      const hasAnyStillReachableCaptain = pendingCaptains.some((captain) =>
        captain.socketId && isSocketConnected(captain.socketId)
      );

      if (!hasAnyStillReachableCaptain) {
        ride.status = 'rejected';
        await ride.save();
        shouldRejectForUser = true;
      }
    }

    if (shouldRejectForUser && ride.user?.socketId) {
      sendMessageToSocketId(ride.user.socketId, {
        event: 'ride-rejected',
        data: {
          rideId: ride._id,
          message: 'Ride request rejected by nearby captains.'
        }
      });
    }

    return res.status(200).json({
      ride,
      allRequestedCaptainsRejected: shouldRejectForUser
    });
  } catch (err) {
    console.error('Error in rejectRide:', err);
    return res.status(err.statusCode || 500).json({ message: err.message || 'Internal server error' });
  }
};

module.exports.startRide = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { rideId, otp } = req.query;

  try {
    const ride = await rideService.startRide({ rideId, otp, captain: req.captain });
    const completeRide = await rideModel.findById(ride._id)
      .populate('user')
      .populate('captain')
      .populate('passengers')
      .populate('passengerAllocations.user')
      .select('+otp');

    if (completeRide.user?.socketId) {
      sendMessageToSocketId(completeRide.user.socketId, {
        event: 'ride-started',
        data: rideService.decorateRideForUser(completeRide, completeRide.user?._id)
      });
    }

    (completeRide.passengers || []).forEach((passenger) => {
      if (!passenger?.socketId) {
        return;
      }

      if (!isPassengerBoardedForRide(completeRide, passenger._id)) {
        return;
      }

      sendMessageToSocketId(passenger.socketId, {
        event: 'ride-started',
        data: rideService.decorateRideForUser(completeRide, passenger._id)
      });
    });

    return res.status(200).json(completeRide);
  } catch (err) {
    console.error('Error in startRide:', err);
    return res.status(err.statusCode || 500).json({ message: err.message || 'Internal server error' });
  }
};

module.exports.endRide = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { rideId } = req.body;

  try {
    const ride = await rideService.endRide({ rideId, captain: req.captain });
    const completeRide = await rideModel.findById(ride._id)
      .populate('user')
      .populate('captain')
      .populate('passengers')
      .populate('passengerAllocations.user')
      .select('+otp');

    if (completeRide.user?.socketId) {
      sendMessageToSocketId(completeRide.user.socketId, {
        event: 'ride-ended',
        data: rideService.decorateRideForUser(completeRide, completeRide.user?._id)
      });
    }

    (completeRide.passengers || []).forEach((passenger) => {
      if (!passenger?.socketId) {
        return;
      }

      sendMessageToSocketId(passenger.socketId, {
        event: 'ride-ended',
        data: rideService.decorateRideForUser(completeRide, passenger._id)
      });
    });

    return res.status(200).json(completeRide);
  } catch (err) {
    console.error('Error in endRide:', err);
    return res.status(err.statusCode || 500).json({ message: err.message || 'Internal server error' });
  }
};

module.exports.confirmPassengerPickup = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { rideId, passengerId, otp } = req.body;

  try {
    const ride = await rideService.confirmPassengerPickup({
      rideId,
      passengerId,
      otp,
      captain: req.captain,
    });

    sendRideUpdateToParticipants(ride);

    const passengerSocketId = Array.isArray(ride?.passengers)
      ? ride.passengers.find((passenger) => normalizeEntityId(passenger?._id) === normalizeEntityId(passengerId))?.socketId
      : null;

    if (passengerSocketId) {
      sendMessageToSocketId(passengerSocketId, {
        event: 'ride-started',
        data: rideService.decorateRideForUser(ride, passengerId),
      });
    }

    return res.status(200).json(ride);
  } catch (err) {
    console.error('Error confirming passenger pickup:', err);
    return res.status(err.statusCode || 500).json({ message: err.message || 'Internal server error' });
  }
};

module.exports.completePassengerDropoff = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { rideId, passengerId } = req.body;

  try {
    const ride = await rideService.completePassengerDropoff({
      rideId,
      passengerId,
      captain: req.captain,
    });

    sendRideUpdateToParticipants(ride);

    const passengerSocketId = Array.isArray(ride?.passengers)
      ? ride.passengers.find((passenger) => normalizeEntityId(passenger?._id) === normalizeEntityId(passengerId))?.socketId
      : null;

    if (passengerSocketId) {
      sendMessageToSocketId(passengerSocketId, {
        event: 'ride-ended',
        data: rideService.decorateRideForUser(ride, passengerId),
      });
    }

    return res.status(200).json(ride);
  } catch (err) {
    console.error('Error completing passenger dropoff:', err);
    return res.status(err.statusCode || 500).json({ message: err.message || 'Internal server error' });
  }
};
