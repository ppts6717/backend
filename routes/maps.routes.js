const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const mapController = require('../controllers/map.controller');
const { body, query } = require('express-validator');

const coordinateStringPattern = /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/;

function hasValidLocationString(value) {
    if (typeof value !== 'string') {
        return false;
    }

    const normalizedValue = value.trim();

    if (!normalizedValue) {
        return false;
    }

    return coordinateStringPattern.test(normalizedValue) || normalizedValue.length >= 3;
}

function validateQueryLocation(fieldName) {
    return query(fieldName).custom((value) => {
        if (hasValidLocationString(value)) {
            return true;
        }

        throw new Error(`${fieldName} is required`);
    });
}

function validateBodyLocation(fieldName) {
    return body(fieldName).custom((value) => {
        if ((typeof value === 'string' && hasValidLocationString(value)) || (value && typeof value === 'object')) {
            return true;
        }

        throw new Error(`${fieldName} is required`);
    });
}

function registerGet(paths, ...handlers) {
    paths.forEach((path) => router.get(path, ...handlers));
}

function registerPost(paths, ...handlers) {
    paths.forEach((path) => router.post(path, ...handlers));
}

registerGet(
    [ '/coordinates', '/get-coordinates' ],
    validateQueryLocation('address'),
    authMiddleware.authUserOrCaptain,
    mapController.getCoordinates
);

registerGet(
    [ '/reverse-geocode', '/address-from-coordinates' ],
    query('lat').isFloat({ min: -90, max: 90 }),
    query('lng').isFloat({ min: -180, max: 180 }),
    authMiddleware.authUserOrCaptain,
    mapController.getAddressFromCoordinates
);

registerGet(
    [ '/distance-time', '/get-distance-time' ],
    validateQueryLocation('origin'),
    validateQueryLocation('destination'),
    authMiddleware.authUserOrCaptain,
    mapController.getDistanceTime
);

registerPost(
    [ '/route', '/get-route' ],
    validateBodyLocation('origin'),
    validateBodyLocation('destination'),
    body('waypoints').optional().isArray(),
    authMiddleware.authUserOrCaptain,
    mapController.getRoute
);

registerGet(
    [ '/suggestions', '/autocomplete', '/get-suggestions' ],
    query('input').custom((value) => {
        if (hasValidLocationString(value)) {
            return true;
        }

        throw new Error('input is required');
    }),
    authMiddleware.authUserOrCaptain,
    mapController.getAutoCompleteSuggestions
);

module.exports = router;
