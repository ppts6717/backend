const mapService = require('../services/maps.service');
const { validationResult } = require('express-validator');

// Update the createRide function:
module.exports.createRide = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { pickup, destination } = req.body;
    
    // Add coordinate validation
    const pickupCoordinates = await mapService.getAddressCoordinate(pickup);
    const destinationCoordinates = await mapService.getAddressCoordinate(destination);
    
    if (!pickupCoordinates || !destinationCoordinates) {
      return res.status(400).json({ message: 'Invalid address coordinates' });
    }

    const ride = await rideService.createRide({ 
      user: req.user._id, 
      pickup, 
      destination, 
      vehicleType: req.body.vehicleType 
    });

    // Remove any other response sends in this function
    return res.status(201).json(ride);

  } catch (err) {
    console.error('Create ride error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ message: err.message });
    }
  }
};

module.exports.getCoordinates = async (req, res, next) => {
    const errors = validationResult(req);
    console.log(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }


    const { address } = req.query;

    try {
        const coordinates = await mapService.getAddressCoordinate(address);
        res.status(200).json(coordinates);
    } catch (error) {
        res.status(404).json({ message: 'Coordinates not found' });
    }
}

module.exports.getDistanceTime = async (req, res, next) => {

    try {

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { origin, destination } = req.query;

        const distanceTime = await mapService.getDistanceTime(origin, destination);

        res.status(200).json(distanceTime);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
}

module.exports.getAutoCompleteSuggestions = async (req, res, next) => {

    try {

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { input } = req.query;

        const suggestions = await mapService.getAutoCompleteSuggestions(input);

        res.status(200).json(suggestions);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
}