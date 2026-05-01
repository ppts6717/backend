const mapService = require('../services/maps.service');
const { validationResult } = require('express-validator');

function sendMapError(res, error, fallbackMessage) {
    const statusCode = error?.statusCode
        || (error?.response?.status ? error.response.status : 500);

    return res.status(statusCode).json({
        message: error?.message || fallbackMessage
    });
}

module.exports.getCoordinates = async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }


    const { address } = req.query;

    try {
        const coordinates = await mapService.getAddressCoordinate(address);
        res.status(200).json(coordinates);
    } catch (error) {
        console.error('Geocode controller error:', error?.response?.data || error?.message || error);
        return sendMapError(res, error, 'Unable to resolve the provided address');
    }
}

module.exports.getAddressFromCoordinates = async (req, res, next) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { lat, lng } = req.query;

    try {
        const address = await mapService.getAddressFromCoordinates(lat, lng);
        res.status(200).json({ address });
    } catch (error) {
        console.error('Reverse geocode controller error:', error?.response?.data || error?.message || error);
        return sendMapError(res, error, 'Unable to resolve the current pickup location');
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
        console.error('Distance-time controller error:', err?.response?.data || err?.message || err);
        return sendMapError(res, err, 'Unable to calculate distance and time right now');
    }
}

module.exports.getRoute = async (req, res, next) => {

    try {

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { origin, destination, waypoints = [] } = req.body;

        const route = await mapService.getDirectionsRoute(origin, destination, waypoints);

        res.status(200).json(route);

    } catch (err) {
        console.error('Route controller error:', err?.response?.data || err?.message || err);
        return sendMapError(res, err, 'Unable to load route directions right now');
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
        console.error('Autocomplete controller error:', err?.response?.data || err?.message || err);
        return sendMapError(res, err, 'Unable to fetch location suggestions right now');
    }
}
