const axios = require('axios');
const captainModel = require('../models/captain.model');
const { decodePath } = require('@googlemaps/google-maps-services-js/dist/util');

function normalizeCoordinate(location) {
    if (!location) {
        return null;
    }

    const latitude = Number(location.ltd ?? location.lat);
    const longitude = Number(location.lng);

    if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
        return null;
    }

    return {
        ltd: latitude,
        lng: longitude
    };
}

function serializeLocation(location) {
    if (typeof location === 'string' && location.trim()) {
        return location.trim();
    }

    const normalizedCoordinate = normalizeCoordinate(location);

    if (!normalizedCoordinate) {
        throw new Error('Invalid location provided');
    }

    return `${normalizedCoordinate.ltd},${normalizedCoordinate.lng}`;
}

function dedupeRouteCoordinates(coordinates = []) {
    return coordinates.reduce((accumulator, coordinate) => {
        const normalizedCoordinate = normalizeCoordinate(coordinate);
        const previousCoordinate = accumulator[ accumulator.length - 1 ];

        if (!normalizedCoordinate) {
            return accumulator;
        }

        if (
            previousCoordinate &&
            previousCoordinate.ltd === normalizedCoordinate.ltd &&
            previousCoordinate.lng === normalizedCoordinate.lng
        ) {
            return accumulator;
        }

        accumulator.push(normalizedCoordinate);
        return accumulator;
    }, []);
}

module.exports.getAddressCoordinate = async (address) => {
    const apiKey = process.env.GOOGLE_MAPS_API;
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;

    try {
        const response = await axios.get(url);
        if (response.data.status === 'OK') {
            const location = response.data.results[ 0 ].geometry.location;
            return {
                ltd: location.lat,
                lng: location.lng
            };
        } else {
            throw new Error('Unable to fetch coordinates');
        }
    } catch (error) {
        console.error(error);
        throw error;
    }
}

module.exports.getAddressFromCoordinates = async (lat, lng) => {
    const latitude = Number(lat);
    const longitude = Number(lng);

    if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
        throw new Error('Latitude and longitude are required');
    }

    const apiKey = process.env.GOOGLE_MAPS_API;
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(`${latitude},${longitude}`)}&key=${apiKey}`;

    try {
        const response = await axios.get(url);

        if (response.data.status === 'OK' && response.data.results?.[ 0 ]?.formatted_address) {
            return response.data.results[ 0 ].formatted_address;
        }

        throw new Error('Unable to fetch address');
    } catch (error) {
        console.error(error);
        throw error;
    }
}

module.exports.getDistanceTime = async (origin, destination) => {
    if (!origin || !destination) {
        throw new Error('Origin and destination are required');
    }

    const apiKey = process.env.GOOGLE_MAPS_API;

    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destination)}&key=${apiKey}`;

    try {


        const response = await axios.get(url);
        if (response.data.status === 'OK') {

            if (response.data.rows[ 0 ].elements[ 0 ].status === 'ZERO_RESULTS') {
                throw new Error('No routes found');
            }

            return response.data.rows[ 0 ].elements[ 0 ];
        } else {
            throw new Error('Unable to fetch distance and time');
        }

    } catch (err) {
        console.error(err);
        throw err;
    }
}

module.exports.getDirectionsRoute = async (origin, destination, waypoints = []) => {
    if (!origin || !destination) {
        throw new Error('Origin and destination are required');
    }

    const apiKey = process.env.GOOGLE_MAPS_API;
    const serializedOrigin = serializeLocation(origin);
    const serializedDestination = serializeLocation(destination);
    const serializedWaypoints = (Array.isArray(waypoints) ? waypoints : [])
        .map((waypoint) => serializeLocation(waypoint))
        .filter(Boolean);

    const queryParts = [
        `origin=${encodeURIComponent(serializedOrigin)}`,
        `destination=${encodeURIComponent(serializedDestination)}`,
        `key=${apiKey}`
    ];

    if (serializedWaypoints.length) {
        queryParts.push(`waypoints=${encodeURIComponent(serializedWaypoints.join('|'))}`);
    }

    const url = `https://maps.googleapis.com/maps/api/directions/json?${queryParts.join('&')}`;

    try {
        const response = await axios.get(url);

        if (response.data.status !== 'OK' || !Array.isArray(response.data.routes) || !response.data.routes.length) {
            throw new Error('Unable to fetch route directions');
        }

        const primaryRoute = response.data.routes[ 0 ];
        const legs = Array.isArray(primaryRoute.legs) ? primaryRoute.legs : [];
        const decodedStepCoordinates = legs.flatMap((leg) =>
            (Array.isArray(leg.steps) ? leg.steps : []).flatMap((step) =>
                step?.polyline?.points
                    ? decodePath(step.polyline.points).map((coordinate) => ({
                        ltd: coordinate.lat,
                        lng: coordinate.lng
                    }))
                    : []
            )
        );
        const fallbackCoordinates = primaryRoute?.overview_polyline?.points
            ? decodePath(primaryRoute.overview_polyline.points).map((coordinate) => ({
                ltd: coordinate.lat,
                lng: coordinate.lng
            }))
            : [];
        const routeCoordinates = dedupeRouteCoordinates(
            decodedStepCoordinates.length ? decodedStepCoordinates : fallbackCoordinates
        );

        return {
            coordinates: routeCoordinates,
            polyline: primaryRoute?.overview_polyline?.points || '',
            totalDistanceMeters: legs.reduce(
                (sum, leg) => sum + (Number(leg?.distance?.value) || 0),
                0
            ),
            totalDurationSeconds: legs.reduce(
                (sum, leg) => sum + (Number(leg?.duration?.value) || 0),
                0
            ),
            legs: legs.map((leg) => ({
                startAddress: leg?.start_address || '',
                endAddress: leg?.end_address || '',
                distanceMeters: Number(leg?.distance?.value) || 0,
                durationSeconds: Number(leg?.duration?.value) || 0
            }))
        };
    } catch (error) {
        console.error(error);
        throw error;
    }
}

module.exports.getAutoCompleteSuggestions = async (input) => {
    if (!input) {
        throw new Error('query is required');
    }

    const apiKey = process.env.GOOGLE_MAPS_API;
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&key=${apiKey}`;

    try {
        const response = await axios.get(url);
        if (response.data.status === 'OK') {
            return response.data.predictions.map(prediction => prediction.description).filter(value => value);
        } else {
            throw new Error('Unable to fetch suggestions');
        }
    } catch (err) {
        console.error(err);
        throw err;
    }
}

module.exports.getCaptainsInTheRadius = async (ltd, lng, radius) => {
    const source = { ltd, lng };
    const captains = await captainModel.find({
        'location.ltd': { $ne: null },
        'location.lng': { $ne: null }
    });

    return captains.filter((captain) =>
        module.exports.calculateDistanceInMeters(source, captain.location) <= radius
    );
}

module.exports.calculateDistanceInMeters = (source, target) => {
    if (!source || !target) {
        return Number.POSITIVE_INFINITY;
    }

    const sourceLat = Number(source.ltd);
    const sourceLng = Number(source.lng);
    const targetLat = Number(target.ltd);
    const targetLng = Number(target.lng);

    if ([ sourceLat, sourceLng, targetLat, targetLng ].some((value) => Number.isNaN(value))) {
        return Number.POSITIVE_INFINITY;
    }

    const earthRadiusMeters = 6371000;
    const toRadians = (degrees) => (degrees * Math.PI) / 180;

    const latitudeDelta = toRadians(targetLat - sourceLat);
    const longitudeDelta = toRadians(targetLng - sourceLng);
    const sourceLatitudeRadians = toRadians(sourceLat);
    const targetLatitudeRadians = toRadians(targetLat);

    const haversine =
        (Math.sin(latitudeDelta / 2) ** 2) +
        (Math.cos(sourceLatitudeRadians) * Math.cos(targetLatitudeRadians) * (Math.sin(longitudeDelta / 2) ** 2));

    const centralAngle = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));

    return earthRadiusMeters * centralAngle;
}

module.exports.isWithinRadius = (source, target, radiusMeters) => {
    return module.exports.calculateDistanceInMeters(source, target) <= radiusMeters;
}
