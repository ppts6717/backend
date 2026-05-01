const axios = require('axios');
const captainModel = require('../models/captain.model');

const OLA_MAPS_BASE_URL = 'https://api.olamaps.io';
const olaResponseCache = new Map();
const olaInFlightRequests = new Map();
const OLA_CACHE_TTL_MS = {
    '/places/v1/geocode': 1000 * 60 * 60 * 6,
    '/places/v1/reverse-geocode': 1000 * 60 * 30,
    '/places/v1/autocomplete': 1000 * 60 * 5,
    '/routing/v1/directions/basic': 1000 * 60 * 5,
    '/routing/v1/directions': 1000 * 60 * 5
};
const OLA_DIRECTIONS_PATHS = [
    '/routing/v1/directions/basic',
    '/routing/v1/directions'
];

function getOlaMapsApiKey() {
    const apiKey = String(process.env.OLA_MAPS_API_KEY || '').trim();

    if (!apiKey) {
        throw new Error('OLA Maps API key is not configured');
    }

    return apiKey;
}

function getOlaCacheTtl(path) {
    return OLA_CACHE_TTL_MS[ path ] || 0;
}

function serializeCacheValue(value) {
    if (Array.isArray(value)) {
        return value.map((item) => serializeCacheValue(item));
    }

    if (value && typeof value === 'object') {
        return Object.keys(value)
            .sort()
            .reduce((accumulator, key) => {
                accumulator[ key ] = serializeCacheValue(value[ key ]);
                return accumulator;
            }, {});
    }

    return value;
}

function buildOlaRequestCacheKey({ method, path, params = {} }) {
    return JSON.stringify({
        method: String(method || 'get').toLowerCase(),
        path,
        params: serializeCacheValue(params)
    });
}

function getCachedOlaResponse(cacheKey) {
    const cacheEntry = olaResponseCache.get(cacheKey);

    if (!cacheEntry) {
        return null;
    }

    if (cacheEntry.expiresAt <= Date.now()) {
        return {
            ...cacheEntry,
            isExpired: true
        };
    }

    return {
        ...cacheEntry,
        isExpired: false
    };
}

function setCachedOlaResponse(cacheKey, data, ttlMs) {
    if (!ttlMs) {
        return;
    }

    olaResponseCache.set(cacheKey, {
        data,
        expiresAt: Date.now() + ttlMs
    });
}

function buildRateLimitError(error) {
    const retryAfterSeconds = Number(
        error?.response?.headers?.[ 'retry-after' ] ||
        error?.response?.headers?.[ 'x-ratelimit-reset' ]
    );
    const rateLimitError = new Error(
        retryAfterSeconds > 0
            ? `Ola Maps is rate-limiting requests. Please wait about ${retryAfterSeconds} seconds and try again.`
            : 'Ola Maps is rate-limiting requests right now. Please wait a few seconds and try again.'
    );

    rateLimitError.statusCode = 429;
    rateLimitError.retryAfterSeconds = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds
        : null;

    return rateLimitError;
}

function getProviderStatusCode(error) {
    return Number(error?.statusCode || error?.response?.status || 0);
}

function isApproximateFallbackCandidate(error) {
    const providerStatusCode = getProviderStatusCode(error);
    const normalizedErrorCode = String(error?.code || '').toUpperCase();

    return [ 401, 403, 429 ].includes(providerStatusCode) ||
        providerStatusCode >= 500 ||
        [ 'ECONNABORTED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT' ].includes(normalizedErrorCode);
}

function shouldUseGeocodeSuggestionFallback(error) {
    const providerStatusCode = getProviderStatusCode(error);
    const normalizedErrorCode = String(error?.code || '').toUpperCase();

    return [ 401, 403, 429 ].includes(providerStatusCode) ||
        providerStatusCode >= 500 ||
        [ 'ECONNABORTED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT' ].includes(normalizedErrorCode);
}

function normalizeCoordinate(location) {
    if (!location) {
        return null;
    }

    const latitude = Number(location.ltd ?? location.lat ?? location.latitude);
    const longitude = Number(location.lng ?? location.lon ?? location.longitude);

    if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
        return null;
    }

    return {
        ltd: latitude,
        lng: longitude
    };
}

function parseCoordinateString(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmedValue = value.trim();

    if (!trimmedValue) {
        return null;
    }

    const coordinateMatch = trimmedValue.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);

    if (!coordinateMatch) {
        return null;
    }

    const latitude = Number(coordinateMatch[ 1 ]);
    const longitude = Number(coordinateMatch[ 2 ]);

    if (
        Number.isNaN(latitude) ||
        Number.isNaN(longitude) ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
    ) {
        return null;
    }

    return {
        ltd: latitude,
        lng: longitude
    };
}

function formatCoordinateLabel(latitude, longitude) {
    return `${Number(latitude).toFixed(6)}, ${Number(longitude).toFixed(6)}`;
}

function formatLocationLabel(location, fallbackCoordinate) {
    if (typeof location === 'string' && location.trim()) {
        return location.trim();
    }

    const normalizedCoordinate = normalizeCoordinate(location) || normalizeCoordinate(fallbackCoordinate);

    if (!normalizedCoordinate) {
        return '';
    }

    return formatCoordinateLabel(normalizedCoordinate.ltd, normalizedCoordinate.lng);
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

function decodePolyline(encodedPath = '') {
    if (!encodedPath || typeof encodedPath !== 'string') {
        return [];
    }

    const coordinates = [];
    let index = 0;
    let latitude = 0;
    let longitude = 0;

    while (index < encodedPath.length) {
        let result = 0;
        let shift = 0;
        let byte = 0;

        do {
            byte = encodedPath.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);

        latitude += (result & 1) ? ~(result >> 1) : (result >> 1);

        result = 0;
        shift = 0;

        do {
            byte = encodedPath.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);

        longitude += (result & 1) ? ~(result >> 1) : (result >> 1);

        coordinates.push({
            ltd: latitude / 1e5,
            lng: longitude / 1e5
        });
    }

    return coordinates;
}

function getPrimaryCollection(responseData) {
    if (Array.isArray(responseData)) {
        return responseData;
    }

    if (!responseData || typeof responseData !== 'object') {
        return [];
    }

    const candidateCollections = [
        responseData.geocodingResults,
        responseData.reverseGeocodingResults,
        responseData.results,
        responseData.predictions,
        responseData.autocompleteResults,
        responseData.places,
        responseData.data
    ];

    return candidateCollections.find((collection) => Array.isArray(collection)) || [];
}

function extractCoordinateFromCandidate(candidate) {
    if (!candidate) {
        return null;
    }

    const coordinateCandidates = [
        candidate?.geometry?.location,
        candidate?.location,
        candidate?.latlng,
        candidate?.latLng,
        candidate?.coordinate,
        candidate?.position,
        candidate?.properties?.location
    ];

    for (const coordinateCandidate of coordinateCandidates) {
        const normalizedCoordinate = normalizeCoordinate(coordinateCandidate);

        if (normalizedCoordinate) {
            return normalizedCoordinate;
        }
    }

    const geometryCoordinates = candidate?.geometry?.coordinates;
    if (Array.isArray(geometryCoordinates) && geometryCoordinates.length >= 2) {
        const longitude = Number(geometryCoordinates[ 0 ]);
        const latitude = Number(geometryCoordinates[ 1 ]);

        if (!Number.isNaN(latitude) && !Number.isNaN(longitude)) {
            return {
                ltd: latitude,
                lng: longitude
            };
        }
    }

    return normalizeCoordinate(candidate);
}

function extractAddressFromCandidate(candidate) {
    if (!candidate) {
        return '';
    }

    const addressCandidates = [
        candidate.formatted_address,
        candidate.formattedAddress,
        candidate.formatted_address_text,
        candidate.description,
        candidate.display_name,
        candidate.place_name,
        candidate.name,
        candidate.label,
        candidate.address,
        candidate.properties?.formatted_address,
        candidate.properties?.label,
        candidate.properties?.name
    ];

    return String(addressCandidates.find((value) => typeof value === 'string' && value.trim()) || '').trim();
}

function extractSuggestionLabel(candidate) {
    if (!candidate) {
        return '';
    }

    const suggestionCandidates = [
        candidate.formatted_address,
        candidate.description,
        candidate.display_name,
        candidate.place_name,
        candidate.formattedAddress,
        candidate.formatted_address_text,
        candidate.name,
        candidate.label,
        candidate.address
    ];

    return String(
        suggestionCandidates.find((value) => typeof value === 'string' && value.trim()) || ''
    ).trim();
}

function extractNumber(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : 0;
}

function extractDistanceMeters(candidate) {
    if (!candidate || typeof candidate !== 'object') {
        return 0;
    }

    return (
        extractNumber(candidate?.distance) ||
        extractNumber(candidate?.distance?.value) ||
        extractNumber(candidate?.distanceMeters) ||
        extractNumber(candidate?.distance_meters) ||
        extractNumber(candidate?.summary?.distance) ||
        extractNumber(candidate?.summary?.distanceMeters) ||
        extractNumber(candidate?.route?.distance) ||
        extractNumber(candidate?.lengthInMeters) ||
        0
    );
}

function extractDurationSeconds(candidate) {
    if (!candidate || typeof candidate !== 'object') {
        return 0;
    }

    return (
        extractNumber(candidate?.duration) ||
        extractNumber(candidate?.duration?.value) ||
        extractNumber(candidate?.durationSeconds) ||
        extractNumber(candidate?.duration_seconds) ||
        extractNumber(candidate?.summary?.duration) ||
        extractNumber(candidate?.summary?.durationSeconds) ||
        extractNumber(candidate?.route?.duration) ||
        extractNumber(candidate?.travelTimeInSeconds) ||
        0
    );
}

function formatDistanceText(distanceMeters) {
    const normalizedDistanceMeters = extractNumber(distanceMeters);

    if (!normalizedDistanceMeters) {
        return '';
    }

    if (normalizedDistanceMeters < 1000) {
        return `${Math.round(normalizedDistanceMeters)} m`;
    }

    const distanceKilometers = normalizedDistanceMeters / 1000;
    const formattedDistance = distanceKilometers >= 10
        ? distanceKilometers.toFixed(0)
        : distanceKilometers.toFixed(1);

    return `${formattedDistance} km`;
}

function formatDurationText(durationSeconds) {
    const normalizedDurationSeconds = extractNumber(durationSeconds);

    if (!normalizedDurationSeconds) {
        return '';
    }

    const totalMinutes = Math.max(1, Math.round(normalizedDurationSeconds / 60));

    if (totalMinutes < 60) {
        return `${totalMinutes} mins`;
    }

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (!minutes) {
        return `${hours} hr`;
    }

    return `${hours} hr ${minutes} mins`;
}

function extractPolylineFromRoute(route) {
    const polylineCandidates = [
        route?.polyline,
        route?.geometry,
        route?.overview_polyline,
        route?.geometry?.polyline,
        route?.overview_polyline?.points
    ];

    return polylineCandidates.find((value) => typeof value === 'string' && value.trim()) || '';
}

function extractCoordinatesFromGeometry(geometry) {
    if (!geometry) {
        return [];
    }

    if (typeof geometry === 'string') {
        return decodePolyline(geometry);
    }

    const geometryCoordinates = Array.isArray(geometry?.coordinates)
        ? geometry.coordinates
        : Array.isArray(geometry)
            ? geometry
            : [];

    return geometryCoordinates
        .map((coordinate) => {
            if (Array.isArray(coordinate) && coordinate.length >= 2) {
                return {
                    ltd: Number(coordinate[ 1 ]),
                    lng: Number(coordinate[ 0 ])
                };
            }

            return normalizeCoordinate(coordinate);
        })
        .filter(Boolean);
}

function extractCoordinatesFromLegs(legs = []) {
    return legs.flatMap((leg) =>
        (Array.isArray(leg?.steps) ? leg.steps : []).flatMap((step) => {
            const stepGeometryCoordinates = extractCoordinatesFromGeometry(step?.geometry);

            if (stepGeometryCoordinates.length) {
                return stepGeometryCoordinates;
            }

            return [];
        })
    );
}

function buildFallbackLeg(originCoordinate, destinationCoordinate, totalDistanceMeters, totalDurationSeconds) {
    return {
        startAddress: '',
        endAddress: '',
        distanceMeters: totalDistanceMeters,
        durationSeconds: totalDurationSeconds,
        startLocation: originCoordinate || null,
        endLocation: destinationCoordinate || null
    };
}

function normalizeLegs(route, originCoordinate, destinationCoordinate) {
    const legs = Array.isArray(route?.legs) ? route.legs : [];

    if (!legs.length) {
        return [];
    }

    return legs.map((leg, index) => {
        const defaultStartLocation = index === 0
            ? originCoordinate
            : extractCoordinateFromCandidate(legs[ index - 1 ]?.end_location);
        const defaultEndLocation = index === legs.length - 1
            ? destinationCoordinate
            : extractCoordinateFromCandidate(legs[ index + 1 ]?.start_location);

        return {
            startAddress: String(
                leg?.start_address ||
                leg?.summary?.startAddress ||
                leg?.start?.name ||
                ''
            ).trim(),
            endAddress: String(
                leg?.end_address ||
                leg?.summary?.endAddress ||
                leg?.end?.name ||
                ''
            ).trim(),
            distanceMeters: extractDistanceMeters(leg),
            durationSeconds: extractDurationSeconds(leg),
            startLocation: extractCoordinateFromCandidate(leg?.start_location) || defaultStartLocation || null,
            endLocation: extractCoordinateFromCandidate(leg?.end_location) || defaultEndLocation || null,
            steps: Array.isArray(leg?.steps) ? leg.steps : []
        };
    });
}

function extractRouteCoordinates(route, normalizedLegs) {
    const geometryCoordinateSets = [
        extractCoordinatesFromGeometry(route?.geometry),
        extractCoordinatesFromGeometry(route?.overview_polyline?.coordinates),
        decodePolyline(extractPolylineFromRoute(route)),
        extractCoordinatesFromLegs(normalizedLegs)
    ];

    const bestCoordinateSet = geometryCoordinateSets.find((coordinateSet) => Array.isArray(coordinateSet) && coordinateSet.length);
    return dedupeRouteCoordinates(bestCoordinateSet || []);
}

function estimateRoadDistanceMeters(straightLineDistanceMeters) {
    const normalizedDistance = extractNumber(straightLineDistanceMeters);

    if (!normalizedDistance) {
        return 0;
    }

    return Math.max(
        Math.round(normalizedDistance * 1.18),
        Math.round(normalizedDistance + 50)
    );
}

function estimateUrbanDurationSeconds(distanceMeters) {
    const normalizedDistance = extractNumber(distanceMeters);

    if (!normalizedDistance) {
        return 0;
    }

    const averageCitySpeedMetersPerSecond = 6.5;
    return Math.max(60, Math.round(normalizedDistance / averageCitySpeedMetersPerSecond));
}

function buildApproximateRouteFallback({
    origin,
    destination,
    waypoints = [],
    resolvedOrigin,
    resolvedDestination,
    resolvedWaypoints = []
}) {
    const routeStops = [
        {
            input: origin,
            coordinate: normalizeCoordinate(resolvedOrigin)
        },
        ...(Array.isArray(resolvedWaypoints)
            ? resolvedWaypoints.map((waypoint, index) => ({
                input: Array.isArray(waypoints) ? waypoints[ index ] : undefined,
                coordinate: normalizeCoordinate(waypoint)
            }))
            : []),
        {
            input: destination,
            coordinate: normalizeCoordinate(resolvedDestination)
        }
    ].filter((routeStop) => routeStop.coordinate);

    if (routeStops.length < 2) {
        const fallbackError = new Error('Unable to approximate route details');
        fallbackError.statusCode = 503;
        throw fallbackError;
    }

    const coordinates = dedupeRouteCoordinates(routeStops.map((routeStop) => routeStop.coordinate));
    let totalDistanceMeters = 0;
    let totalDurationSeconds = 0;

    const legs = [];

    for (let index = 1; index < routeStops.length; index += 1) {
        const startStop = routeStops[ index - 1 ];
        const endStop = routeStops[ index ];
        const straightLineDistanceMeters = module.exports.calculateDistanceInMeters(
            startStop.coordinate,
            endStop.coordinate
        );
        const distanceMeters = estimateRoadDistanceMeters(straightLineDistanceMeters);
        const durationSeconds = estimateUrbanDurationSeconds(distanceMeters);

        totalDistanceMeters += distanceMeters;
        totalDurationSeconds += durationSeconds;

        legs.push({
            startAddress: formatLocationLabel(startStop.input, startStop.coordinate),
            endAddress: formatLocationLabel(endStop.input, endStop.coordinate),
            distanceMeters,
            durationSeconds,
            startLocation: startStop.coordinate,
            endLocation: endStop.coordinate,
            isApproximate: true
        });
    }

    return {
        coordinates,
        polyline: '',
        totalDistanceMeters,
        totalDurationSeconds,
        legs,
        isApproximate: true,
        status: 'APPROXIMATE'
    };
}

async function requestOlaMaps({
    method = 'get',
    path,
    params = {},
    data = undefined
}) {
    const cacheTtlMs = getOlaCacheTtl(path);
    const cacheKey = buildOlaRequestCacheKey({
        method,
        path,
        params
    });
    const cachedResponse = getCachedOlaResponse(cacheKey);
    const apiKey = getOlaMapsApiKey();
    const authParamAttempts = [
        {
            ...params,
            api_key: apiKey
        },
        {
            ...params,
            key: apiKey
        }
    ];

    if (cachedResponse && !cachedResponse.isExpired) {
        return cachedResponse.data;
    }

    if (olaInFlightRequests.has(cacheKey)) {
        return olaInFlightRequests.get(cacheKey);
    }

    const requestPromise = (async () => {
        let lastError = null;

        for (let attemptIndex = 0; attemptIndex < authParamAttempts.length; attemptIndex += 1) {
            const requestParams = authParamAttempts[ attemptIndex ];

            try {
                const response = await axios({
                    method,
                    url: `${OLA_MAPS_BASE_URL}${path}`,
                    params: requestParams,
                    data,
                    timeout: 15000,
                    headers: {
                        'X-Request-Id': `tripzzy-${Date.now()}`
                    }
                });

                setCachedOlaResponse(cacheKey, response.data, cacheTtlMs);
                return response.data;
            } catch (error) {
                lastError = error;

                if (error?.response?.status === 429) {
                    if (cachedResponse?.data) {
                        return cachedResponse.data;
                    }

                    throw buildRateLimitError(error);
                }

                const providerStatusCode = getProviderStatusCode(error);
                const canRetryWithAlternateAuthParam =
                    attemptIndex < authParamAttempts.length - 1 &&
                    [ 401, 403 ].includes(providerStatusCode);

                if (canRetryWithAlternateAuthParam) {
                    continue;
                }

                console.error(error?.response?.data || error);
                throw error;
            }
        }

        console.error(lastError?.response?.data || lastError);
        throw lastError || new Error('Unable to reach Ola Maps');
    })()
        .finally(() => {
            olaInFlightRequests.delete(cacheKey);
        });

    olaInFlightRequests.set(cacheKey, requestPromise);
    return requestPromise;
}

async function resolveRouteLocation(location) {
    if (typeof location === 'string' && location.trim()) {
        return module.exports.getAddressCoordinate(location.trim());
    }

    const normalizedCoordinate = normalizeCoordinate(location);

    if (!normalizedCoordinate) {
        throw new Error('Invalid location provided');
    }

    return normalizedCoordinate;
}

async function fetchRouteResponse(origin, destination, waypoints = [], options = {}) {
    const { allowApproximateFallback = false } = options;
    const resolvedOrigin = await resolveRouteLocation(origin);
    const resolvedDestination = await resolveRouteLocation(destination);
    const resolvedWaypoints = await Promise.all(
        (Array.isArray(waypoints) ? waypoints : []).map((waypoint) => resolveRouteLocation(waypoint))
    );

    const serializedWaypoints = resolvedWaypoints.map((waypoint) => serializeLocation(waypoint));
    try {
        let routeData = null;
        let lastRouteError = null;

        for (const directionsPath of OLA_DIRECTIONS_PATHS) {
            try {
                routeData = await requestOlaMaps({
                    method: 'post',
                    path: directionsPath,
                    params: {
                        origin: serializeLocation(resolvedOrigin),
                        destination: serializeLocation(resolvedDestination),
                        ...(serializedWaypoints.length ? { waypoints: serializedWaypoints.join(', ') } : {})
                    }
                });
                break;
            } catch (error) {
                lastRouteError = error;
                const providerStatusCode = getProviderStatusCode(error);
                const canTryAlternateDirectionsEndpoint =
                    directionsPath !== OLA_DIRECTIONS_PATHS[ OLA_DIRECTIONS_PATHS.length - 1 ] &&
                    [ 401, 403, 404, 405 ].includes(providerStatusCode);

                if (!canTryAlternateDirectionsEndpoint) {
                    throw error;
                }
            }
        }

        if (!routeData) {
            throw lastRouteError || new Error('Unable to fetch route directions');
        }

        return {
            routeData,
            resolvedOrigin,
            resolvedDestination,
            resolvedWaypoints,
            routeError: null
        };
    } catch (error) {
        if (!allowApproximateFallback || !isApproximateFallbackCandidate(error)) {
            throw error;
        }

        return {
            routeData: null,
            resolvedOrigin,
            resolvedDestination,
            resolvedWaypoints,
            routeError: error
        };
    }
}

module.exports.getAddressCoordinate = async (address) => {
    if (!address || !String(address).trim()) {
        throw new Error('Address is required');
    }

    const coordinateFromString = parseCoordinateString(String(address));

    if (coordinateFromString) {
        return coordinateFromString;
    }

    const responseData = await requestOlaMaps({
        path: '/places/v1/geocode',
        params: {
            address: String(address).trim()
        }
    });
    const primaryResult = getPrimaryCollection(responseData)[ 0 ] || responseData;
    const coordinate = extractCoordinateFromCandidate(primaryResult);

    if (!coordinate) {
        throw new Error('Unable to fetch coordinates');
    }

    return coordinate;
};

module.exports.getAddressFromCoordinates = async (lat, lng) => {
    const latitude = Number(lat);
    const longitude = Number(lng);

    if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
        throw new Error('Latitude and longitude are required');
    }

    try {
        const responseData = await requestOlaMaps({
            path: '/places/v1/reverse-geocode',
            params: {
                latlng: `${latitude},${longitude}`
            }
        });
        const primaryResult = getPrimaryCollection(responseData)[ 0 ] || responseData;
        const formattedAddress = extractAddressFromCandidate(primaryResult);

        if (formattedAddress) {
            return formattedAddress;
        }
    } catch (error) {
        console.error('Reverse geocode lookup failed, falling back to coordinates:', error?.response?.data || error?.message || error);
    }

    return formatCoordinateLabel(latitude, longitude);
};

module.exports.getDistanceTime = async (origin, destination) => {
    if (!origin || !destination) {
        throw new Error('Origin and destination are required');
    }

    const {
        routeData,
        resolvedOrigin,
        resolvedDestination,
        routeError
    } = await fetchRouteResponse(origin, destination, [], { allowApproximateFallback: true });
    const approximateRouteFallback = buildApproximateRouteFallback({
        origin,
        destination,
        resolvedOrigin,
        resolvedDestination
    });
    const primaryRoute = Array.isArray(routeData?.routes) ? routeData.routes[ 0 ] : null;

    if (!primaryRoute) {
        if (routeError) {
            return {
                distance: {
                    text: formatDistanceText(approximateRouteFallback.totalDistanceMeters),
                    value: approximateRouteFallback.totalDistanceMeters
                },
                duration: {
                    text: formatDurationText(approximateRouteFallback.totalDurationSeconds),
                    value: approximateRouteFallback.totalDurationSeconds
                },
                status: approximateRouteFallback.status,
                isApproximate: true
            };
        }

        throw new Error('No routes found');
    }

    const normalizedLegs = normalizeLegs(primaryRoute);
    const totalDistanceMeters = normalizedLegs.length
        ? normalizedLegs.reduce((sum, leg) => sum + leg.distanceMeters, 0)
        : extractDistanceMeters(primaryRoute);
    const totalDurationSeconds = normalizedLegs.length
        ? normalizedLegs.reduce((sum, leg) => sum + leg.durationSeconds, 0)
        : extractDurationSeconds(primaryRoute);

    if (!totalDistanceMeters && !totalDurationSeconds) {
        return {
            distance: {
                text: formatDistanceText(approximateRouteFallback.totalDistanceMeters),
                value: approximateRouteFallback.totalDistanceMeters
            },
            duration: {
                text: formatDurationText(approximateRouteFallback.totalDurationSeconds),
                value: approximateRouteFallback.totalDurationSeconds
            },
            status: approximateRouteFallback.status,
            isApproximate: true
        };
    }

    return {
        distance: {
            text: formatDistanceText(totalDistanceMeters),
            value: totalDistanceMeters
        },
        duration: {
            text: formatDurationText(totalDurationSeconds),
            value: totalDurationSeconds
        },
        status: 'OK',
        isApproximate: false
    };
};

module.exports.getDirectionsRoute = async (origin, destination, waypoints = []) => {
    if (!origin || !destination) {
        throw new Error('Origin and destination are required');
    }

    const {
        routeData,
        resolvedOrigin,
        resolvedDestination,
        resolvedWaypoints,
        routeError
    } = await fetchRouteResponse(origin, destination, waypoints, { allowApproximateFallback: true });
    const approximateRouteFallback = buildApproximateRouteFallback({
        origin,
        destination,
        waypoints,
        resolvedOrigin,
        resolvedDestination,
        resolvedWaypoints
    });
    const primaryRoute = Array.isArray(routeData?.routes) ? routeData.routes[ 0 ] : null;

    if (!primaryRoute) {
        if (routeError) {
            return approximateRouteFallback;
        }

        throw new Error('Unable to fetch route directions');
    }

    const normalizedLegs = normalizeLegs(primaryRoute, resolvedOrigin, resolvedDestination);
    const routeCoordinates = extractRouteCoordinates(primaryRoute, normalizedLegs);
    const totalDistanceMeters = normalizedLegs.length
        ? normalizedLegs.reduce((sum, leg) => sum + leg.distanceMeters, 0)
        : extractDistanceMeters(primaryRoute);
    const totalDurationSeconds = normalizedLegs.length
        ? normalizedLegs.reduce((sum, leg) => sum + leg.durationSeconds, 0)
        : extractDurationSeconds(primaryRoute);
    const routeLegs = normalizedLegs.length
        ? normalizedLegs
        : [ buildFallbackLeg(resolvedOrigin, resolvedDestination, totalDistanceMeters, totalDurationSeconds) ];

    if (!routeCoordinates.length || (!totalDistanceMeters && !totalDurationSeconds)) {
        return approximateRouteFallback;
    }

    return {
        coordinates: routeCoordinates,
        polyline: extractPolylineFromRoute(primaryRoute),
        totalDistanceMeters,
        totalDurationSeconds,
        isApproximate: false,
        legs: routeLegs.map((leg) => ({
            startAddress: leg.startAddress,
            endAddress: leg.endAddress,
            distanceMeters: leg.distanceMeters,
            durationSeconds: leg.durationSeconds,
            startLocation: leg.startLocation,
            endLocation: leg.endLocation
        }))
    };
};

module.exports.getAutoCompleteSuggestions = async (input) => {
    if (!input || !String(input).trim()) {
        throw new Error('query is required');
    }

    const normalizedInput = String(input).trim();
    let suggestions = [];

    try {
        const responseData = await requestOlaMaps({
            path: '/places/v1/autocomplete',
            params: {
                input: normalizedInput
            }
        });

        suggestions = getPrimaryCollection(responseData)
            .map((candidate) => extractSuggestionLabel(candidate))
            .filter(Boolean);
    } catch (error) {
        if (!shouldUseGeocodeSuggestionFallback(error)) {
            throw error;
        }

        try {
            const geocodeResponseData = await requestOlaMaps({
                path: '/places/v1/geocode',
                params: {
                    address: normalizedInput
                }
            });

            suggestions = getPrimaryCollection(geocodeResponseData)
                .map((candidate) => extractAddressFromCandidate(candidate) || extractSuggestionLabel(candidate))
                .filter(Boolean);
        } catch (fallbackError) {
            if (!shouldUseGeocodeSuggestionFallback(fallbackError)) {
                throw fallbackError;
            }

            suggestions = [];
        }
    }

    if (!suggestions.length) {
        return [];
    }

    return Array.from(new Set(suggestions));
};

module.exports.getCaptainsInTheRadius = async (ltd, lng, radius) => {
    const source = { ltd, lng };
    const captains = await captainModel.find({
        status: 'active',
        socketId: { $nin: [ null, '' ] },
        'location.ltd': { $ne: null },
        'location.lng': { $ne: null }
    });

    return captains.filter((captain) =>
        module.exports.calculateDistanceInMeters(source, captain.location) <= radius
    );
};

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
};

module.exports.isWithinRadius = (source, target, radiusMeters) => {
    return module.exports.calculateDistanceInMeters(source, target) <= radiusMeters;
};
