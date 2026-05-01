const crypto = require('crypto');
const rideModel = require('../models/ride.model');
const mapService = require('./maps.service');

const vehicleSeatCapacity = {
    auto: 3,
    car: 4,
    moto: 1
};

const captainVehicleTypeMap = {
    auto: 'auto',
    car: 'car',
    bike: 'moto',
    motorcycle: 'moto',
    moto: 'moto'
};

const carpoolDiscoveryConfig = {
    maxPickupDistanceMeters: 5000,
    maxDestinationDistanceMeters: 6000,
    maxRouteDeviationMeters: 1000,
    minOverlapDistanceMeters: 1500,
    minOverlapRatio: 0.35,
    exactMatchDetourMeters: 120,
    passedWaypointBufferMeters: 75
};
const joinableCarpoolRideStatuses = [ 'accepted', 'ongoing' ];
const discoverableCarpoolRideStatuses = [ 'accepted', 'ongoing' ];

const shareableVehicleTypes = [ 'auto', 'car' ];

const fareConfig = {
    auto: {
        baseFare: 30,
        perKmRate: 10,
        perMinuteRate: 2
    },
    car: {
        baseFare: 50,
        perKmRate: 15,
        perMinuteRate: 3
    },
    moto: {
        baseFare: 20,
        perKmRate: 8,
        perMinuteRate: 1.5
    }
};

const ROUTE_POSITION_EPSILON_METERS = 1;

function getVehicleFareConfig(vehicleType) {
    return fareConfig[ vehicleType ] || fareConfig.car;
}

function clampNumber(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
}

function roundToTwoDecimals(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function getCompatibleVehicleTypesForSeats(requiredSeats) {
    return Object.entries(vehicleSeatCapacity)
        .filter(([ vehicleType ]) => shareableVehicleTypes.includes(vehicleType))
        .filter(([, capacity]) => capacity >= requiredSeats)
        .map(([ vehicleType ]) => vehicleType);
}

function getLockedFlexibleFareQuote(fareTable, requiredSeats) {
    const compatibleVehicleTypes = getCompatibleVehicleTypesForSeats(requiredSeats);
    const compatibleFares = compatibleVehicleTypes
        .map((vehicleType) => fareTable?.[ vehicleType ])
        .filter((value) => typeof value === 'number');

    if (!compatibleFares.length) {
        throw new Error('No compatible shared vehicle fare is available for that seat request');
    }

    return Math.min(...compatibleFares);
}

module.exports.getLockedFlexibleFareQuote = getLockedFlexibleFareQuote;

function getStableSharedRouteFareQuote(fareTable) {
    const sharedBaselineVehicleType = 'car';
    const sharedBaselineFare = Number(fareTable?.[ sharedBaselineVehicleType ]);

    if (!sharedBaselineFare) {
        throw new Error('No shared vehicle fare is available for that route');
    }

    return sharedBaselineFare;
}

module.exports.getStableSharedRouteFareQuote = getStableSharedRouteFareQuote;

function isShareableVehicleType(vehicleType) {
    return shareableVehicleTypes.includes(vehicleType);
}

module.exports.isShareableVehicleType = isShareableVehicleType;

function getTotalFareFromPerSeatFare(perSeatFare, bookedSeats) {
    return roundToTwoDecimals((Number(perSeatFare) || 0) * Math.max(1, Number(bookedSeats) || 1));
}

module.exports.getTotalFareFromPerSeatFare = getTotalFareFromPerSeatFare;

function buildFareTableFromDistanceTime(distanceTime) {
    return Object.entries(fareConfig).reduce((accumulator, [ vehicleType, config ]) => {
        const distanceKilometers = (Number(distanceTime?.distance?.value) || 0) / 1000;
        const durationMinutes = (Number(distanceTime?.duration?.value) || 0) / 60;
        accumulator[ vehicleType ] = Math.round(
            config.baseFare +
            (distanceKilometers * config.perKmRate) +
            (durationMinutes * config.perMinuteRate)
        );
        return accumulator;
    }, {});
}

function getFareWeightFromDistanceTime(distanceTime, vehicleType) {
    const config = getVehicleFareConfig(vehicleType);
    const distanceKilometers = (Number(distanceTime?.distance?.value) || 0) / 1000;
    const durationMinutes = (Number(distanceTime?.duration?.value) || 0) / 60;

    return (distanceKilometers * config.perKmRate) + (durationMinutes * config.perMinuteRate);
}

async function calculateCarpoolFare(pickup, destination, availableSeats, rideType) {
    if (!pickup || !destination || !availableSeats) {
        throw new Error('Pickup, destination and available seats are required');
    }

    if (availableSeats < 1 || availableSeats > 4) {
        throw new Error('Carpool must have 1-4 available seats');
    }

    const distanceTime = await mapService.getDistanceTime(pickup, destination);
    const soloFares = buildFareTableFromDistanceTime(distanceTime);

    if (rideType === 'solo') {
        return soloFares;
    }

    return soloFares;
}

module.exports.calculateCarpoolFare = calculateCarpoolFare;

async function getFare(pickup, destination) {
    if (!pickup || !destination) {
        throw new Error('Pickup and destination are required');
    }

    const distanceTime = await mapService.getDistanceTime(pickup, destination);
    return buildFareTableFromDistanceTime(distanceTime);
}

module.exports.getFare = getFare;

function getOtp(num) {
    return crypto.randomInt(Math.pow(10, num - 1), Math.pow(10, num)).toString();
}

function normalizeObjectId(value) {
    return value?.toString?.() || String(value || '');
}

function normalizeCaptainVehicleType(vehicleType) {
    return captainVehicleTypeMap[ String(vehicleType || '').trim().toLowerCase() ] || null;
}

module.exports.normalizeCaptainVehicleType = normalizeCaptainVehicleType;

function getSupportedVehicleCapacity(vehicleType) {
    const normalizedVehicleType = normalizeCaptainVehicleType(vehicleType);
    return vehicleSeatCapacity[ normalizedVehicleType ] || 0;
}

module.exports.getSupportedVehicleCapacity = getSupportedVehicleCapacity;

function getCaptainVehicleCapacity(captain) {
    const supportedVehicleCapacity = getSupportedVehicleCapacity(captain?.vehicle?.vehicleType);
    const declaredCapacity = Number(captain?.vehicle?.capacity);

    if (declaredCapacity > 0 && supportedVehicleCapacity > 0) {
        return Math.min(declaredCapacity, supportedVehicleCapacity);
    }

    if (declaredCapacity > 0) {
        return declaredCapacity;
    }

    return supportedVehicleCapacity;
}

module.exports.getCaptainVehicleCapacity = getCaptainVehicleCapacity;

function getOccupiedSeatCount(ride) {
    const ownerSeatCount = Math.max(1, Number(ride?.bookedSeats) || 1);
    const passengerSeats = Array.isArray(ride?.passengerAllocations) && ride.passengerAllocations.length > 0
        ? ride.passengerAllocations.reduce((sum, passenger) => sum + Math.max(1, Number(passenger?.bookedSeats) || 1), 0)
        : Array.isArray(ride?.passengers)
            ? ride.passengers.length
            : 0;

    return ownerSeatCount + passengerSeats;
}

function getCurrentAvailableSeats(ride, vehicleCapacity) {
    return Math.max(vehicleCapacity - getOccupiedSeatCount(ride), 0);
}

function isCaptainCurrentlyAvailableForCarpool(captain) {
    return Boolean(captain?._id) &&
        String(captain?.status || '').trim().toLowerCase() === 'active' &&
        Boolean(String(captain?.socketId || '').trim());
}

function getPassengerBoardingStatus(allocation) {
    const normalizedStatus = String(allocation?.boardingStatus || '').trim().toLowerCase();
    return normalizedStatus === 'awaiting_pickup' || normalizedStatus === 'completed'
        ? normalizedStatus
        : 'onboard';
}

module.exports.getPassengerBoardingStatus = getPassengerBoardingStatus;

function shouldViewerWaitForPickup(ride, viewerIsOwner, passengerAllocation) {
    if (!ride || viewerIsOwner) {
        return false;
    }

    return ride.rideType === 'carpool' && getPassengerBoardingStatus(passengerAllocation) === 'awaiting_pickup';
}

function buildRideDetailsQuery(filter) {
    const query = typeof filter === 'string'
        ? rideModel.findById(filter)
        : rideModel.findOne(filter);

    return query
        .populate('user')
        .populate('captain')
        .populate('passengers')
        .populate('passengerAllocations.user')
        .select('+otp');
}

async function getRideWithDetails(filter) {
    return buildRideDetailsQuery(filter);
}

function buildCaptainName(captain) {
    const firstName = captain?.fullname?.firstname || '';
    const lastName = captain?.fullname?.lastname || '';
    return `${firstName} ${lastName}`.trim() || 'Assigned captain';
}

function matchesGenderPreference(ridePreference, requestedPreference) {
    if (requestedPreference === 'any') {
        return true;
    }

    return ridePreference === requestedPreference;
}

function getRideBaseRouteFare(ride) {
    if (ride?.rideType !== 'carpool') {
        return roundToTwoDecimals(Number(ride?.fare) || 0);
    }

    const explicitBaseRouteFare = Number(ride?.baseRouteFare);
    if (explicitBaseRouteFare > 0) {
        return roundToTwoDecimals(explicitBaseRouteFare);
    }

    const ownerAllocationFare = Number(ride?.ownerAllocation?.fare);
    if (ownerAllocationFare > 0) {
        return roundToTwoDecimals(ownerAllocationFare);
    }

    const legacyPerSeatFare = Number(ride?.farePerSeat);
    if (legacyPerSeatFare > 0) {
        return roundToTwoDecimals(legacyPerSeatFare);
    }

    return roundToTwoDecimals(Number(ride?.fare) || 0);
}

function createDistanceTimeCache() {
    const cache = new Map();

    return async (origin, destination) => {
        const cacheKey = `${origin}:::${destination}`;
        if (!cache.has(cacheKey)) {
            cache.set(cacheKey, mapService.getDistanceTime(origin, destination));
        }
        return cache.get(cacheKey);
    };
}

function normalizeRouteCoordinate(coordinate) {
    if (!coordinate) {
        return null;
    }

    const latitude = Number(coordinate.ltd ?? coordinate.lat);
    const longitude = Number(coordinate.lng);

    if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
        return null;
    }

    return {
        ltd: latitude,
        lng: longitude
    };
}

function serializeLocationCacheKey(location) {
    if (typeof location === 'string' && location.trim()) {
        return location.trim();
    }

    const normalizedCoordinate = normalizeRouteCoordinate(location);

    if (!normalizedCoordinate) {
        return String(location || '');
    }

    return `${normalizedCoordinate.ltd},${normalizedCoordinate.lng}`;
}

function createDirectionsCache() {
    const cache = new Map();

    return async (origin, destination, waypoints = []) => {
        const cacheKey = [
            serializeLocationCacheKey(origin),
            serializeLocationCacheKey(destination),
            ...waypoints.map((waypoint) => serializeLocationCacheKey(waypoint))
        ].join(':::');

        if (!cache.has(cacheKey)) {
            cache.set(cacheKey, mapService.getDirectionsRoute(origin, destination, waypoints));
        }

        return cache.get(cacheKey);
    };
}

function buildRouteProfile(directionsRoute) {
    const coordinates = Array.isArray(directionsRoute?.coordinates)
        ? directionsRoute.coordinates
            .map((coordinate) => normalizeRouteCoordinate(coordinate))
            .filter(Boolean)
        : [];

    if (coordinates.length < 2) {
        return null;
    }

    const cumulativeDistanceMeters = [ 0 ];

    for (let index = 1; index < coordinates.length; index += 1) {
        cumulativeDistanceMeters.push(
            cumulativeDistanceMeters[ index - 1 ] +
            mapService.calculateDistanceInMeters(coordinates[ index - 1 ], coordinates[ index ])
        );
    }

    const derivedTotalDistanceMeters = cumulativeDistanceMeters[ cumulativeDistanceMeters.length - 1 ];
    const totalDistanceMeters = Number(directionsRoute?.totalDistanceMeters) || derivedTotalDistanceMeters;

    return {
        coordinates,
        cumulativeDistanceMeters,
        totalDistanceMeters: totalDistanceMeters || derivedTotalDistanceMeters,
        totalDurationSeconds: Number(directionsRoute?.totalDurationSeconds) || 0
    };
}

function projectCoordinateToMeters(coordinate, referenceLatitude) {
    const normalizedCoordinate = normalizeRouteCoordinate(coordinate);

    if (!normalizedCoordinate) {
        return null;
    }

    const metersPerDegreeLatitude = 111320;
    const metersPerDegreeLongitude = Math.cos((referenceLatitude * Math.PI) / 180) * 111320;

    return {
        x: normalizedCoordinate.lng * metersPerDegreeLongitude,
        y: normalizedCoordinate.ltd * metersPerDegreeLatitude
    };
}

function findNearestPointOnRoute(routeProfile, coordinate) {
    const normalizedCoordinate = normalizeRouteCoordinate(coordinate);

    if (!routeProfile || !normalizedCoordinate) {
        return null;
    }

    const { coordinates, cumulativeDistanceMeters } = routeProfile;
    let bestProjection = null;

    for (let index = 1; index < coordinates.length; index += 1) {
        const startCoordinate = coordinates[ index - 1 ];
        const endCoordinate = coordinates[ index ];
        const segmentLengthMeters = Math.max(
            mapService.calculateDistanceInMeters(startCoordinate, endCoordinate),
            ROUTE_POSITION_EPSILON_METERS
        );
        const referenceLatitude = (
            Number(startCoordinate.ltd) +
            Number(endCoordinate.ltd) +
            Number(normalizedCoordinate.ltd)
        ) / 3;
        const startPoint = projectCoordinateToMeters(startCoordinate, referenceLatitude);
        const endPoint = projectCoordinateToMeters(endCoordinate, referenceLatitude);
        const targetPoint = projectCoordinateToMeters(normalizedCoordinate, referenceLatitude);

        if (!startPoint || !endPoint || !targetPoint) {
            continue;
        }

        const deltaX = endPoint.x - startPoint.x;
        const deltaY = endPoint.y - startPoint.y;
        const lengthSquared = (deltaX * deltaX) + (deltaY * deltaY);

        if (!lengthSquared) {
            continue;
        }

        const segmentProgress = clampNumber(
            (((targetPoint.x - startPoint.x) * deltaX) + ((targetPoint.y - startPoint.y) * deltaY)) / lengthSquared,
            0,
            1
        );
        const projectedPoint = {
            x: startPoint.x + (segmentProgress * deltaX),
            y: startPoint.y + (segmentProgress * deltaY)
        };
        const distanceMeters = Math.hypot(targetPoint.x - projectedPoint.x, targetPoint.y - projectedPoint.y);
        const routeDistanceMeters = cumulativeDistanceMeters[ index - 1 ] + (segmentLengthMeters * segmentProgress);

        if (!bestProjection || distanceMeters < bestProjection.distanceMeters) {
            bestProjection = {
                distanceMeters,
                routeDistanceMeters,
                segmentIndex: index - 1,
                segmentProgress,
                projectedCoordinate: {
                    ltd: startCoordinate.ltd + ((endCoordinate.ltd - startCoordinate.ltd) * segmentProgress),
                    lng: startCoordinate.lng + ((endCoordinate.lng - startCoordinate.lng) * segmentProgress)
                }
            };
        }
    }

    return bestProjection;
}

function formatDurationText(totalSeconds) {
    const normalizedSeconds = Math.max(0, Math.round(Number(totalSeconds) || 0));

    if (!normalizedSeconds) {
        return '';
    }

    const totalMinutes = Math.max(1, Math.round(normalizedSeconds / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (!hours) {
        return `${totalMinutes} mins`;
    }

    if (!minutes) {
        return `${hours} hr`;
    }

    return `${hours} hr ${minutes} mins`;
}

function buildRouteCompatibility({
    routeProfile,
    pickupCoordinate,
    destinationCoordinate,
    candidateDirectDistanceMeters
}) {
    if (!routeProfile) {
        return null;
    }

    const pickupProjection = findNearestPointOnRoute(routeProfile, pickupCoordinate);
    const destinationProjection = findNearestPointOnRoute(routeProfile, destinationCoordinate);

    if (!pickupProjection || !destinationProjection) {
        return null;
    }

    const overlapDistanceMeters = Math.max(
        0,
        destinationProjection.routeDistanceMeters - pickupProjection.routeDistanceMeters
    );
    const overlapRatio = candidateDirectDistanceMeters > 0
        ? clampNumber(overlapDistanceMeters / candidateDirectDistanceMeters, 0, 1)
        : 0;
    const etaToPickupSeconds = routeProfile.totalDistanceMeters > 0
        ? Math.round(routeProfile.totalDurationSeconds * (pickupProjection.routeDistanceMeters / routeProfile.totalDistanceMeters))
        : null;

    return {
        pickupDetourMeters: Math.round(pickupProjection.distanceMeters),
        destinationDetourMeters: Math.round(destinationProjection.distanceMeters),
        totalDetourMeters: Math.round(pickupProjection.distanceMeters + destinationProjection.distanceMeters),
        overlapMeters: Math.round(overlapDistanceMeters),
        overlapRatio,
        pickupRouteDistanceMeters: Math.round(pickupProjection.routeDistanceMeters),
        destinationRouteDistanceMeters: Math.round(destinationProjection.routeDistanceMeters),
        pickupProgressRatio: routeProfile.totalDistanceMeters > 0
            ? clampNumber(pickupProjection.routeDistanceMeters / routeProfile.totalDistanceMeters, 0, 1)
            : 0,
        destinationProgressRatio: routeProfile.totalDistanceMeters > 0
            ? clampNumber(destinationProjection.routeDistanceMeters / routeProfile.totalDistanceMeters, 0, 1)
            : 0,
        etaToPickupSeconds,
        etaToPickupText: formatDurationText(etaToPickupSeconds),
        exactRouteMatch:
            pickupProjection.distanceMeters <= carpoolDiscoveryConfig.exactMatchDetourMeters &&
            destinationProjection.distanceMeters <= carpoolDiscoveryConfig.exactMatchDetourMeters
    };
}

function normalizeAddressForComparison(address) {
    return String(address || '').trim().toLowerCase();
}

function buildPlannedSharedRouteStops(ride) {
    const rawStops = Array.isArray(ride?.passengerAllocations)
        ? ride.passengerAllocations.flatMap((allocation, index) => {
            const pickupAddress = String(allocation?.pickup || '').trim();
            const destinationAddress = String(allocation?.destination || '').trim();
            const startMeters = Number(allocation?.routeStartMeters);
            const endMeters = Number(allocation?.routeEndMeters);

            if (!pickupAddress || !destinationAddress || !Number.isFinite(startMeters) || !Number.isFinite(endMeters) || endMeters <= startMeters) {
                return [];
            }

            return [
                {
                    key: `pickup-${index}-${startMeters}`,
                    type: 'pickup',
                    address: pickupAddress,
                    positionMeters: startMeters
                },
                {
                    key: `dropoff-${index}-${endMeters}`,
                    type: 'dropoff',
                    address: destinationAddress,
                    positionMeters: endMeters
                }
            ];
        })
        : [];

    return rawStops
        .sort((left, right) => {
            if (left.positionMeters !== right.positionMeters) {
                return left.positionMeters - right.positionMeters;
            }

            return left.type === right.type ? 0 : left.type === 'pickup' ? -1 : 1;
        })
        .filter((stop, index, stops) => {
            const previousStop = stops[ index - 1 ];

            if (!previousStop) {
                return true;
            }

            return !(
                normalizeAddressForComparison(previousStop.address) === normalizeAddressForComparison(stop.address) &&
                previousStop.type === stop.type &&
                Math.abs(previousStop.positionMeters - stop.positionMeters) <= ROUTE_POSITION_EPSILON_METERS
            );
        });
}

function buildDiscoverableRouteWaypoints(
    ride,
    {
        fromRouteDistanceMeters = 0,
        origin = ride?.pickup,
        destination = ride?.destination
    } = {}
) {
    const routeDistanceCutoff = Math.max(0, Number(fromRouteDistanceMeters) || 0);
    const normalizedOrigin = normalizeAddressForComparison(origin);
    const normalizedDestination = normalizeAddressForComparison(destination);
    let lastWaypointKey = '';

    return buildPlannedSharedRouteStops(ride)
        .filter((stop) => stop.positionMeters > (routeDistanceCutoff + carpoolDiscoveryConfig.passedWaypointBufferMeters))
        .map((stop) => String(stop.address || '').trim())
        .filter((address) => {
            const normalizedAddress = normalizeAddressForComparison(address);

            if (!normalizedAddress || normalizedAddress === normalizedDestination) {
                return false;
            }

            if (!lastWaypointKey && normalizedAddress === normalizedOrigin) {
                return false;
            }

            if (normalizedAddress === lastWaypointKey) {
                return false;
            }

            lastWaypointKey = normalizedAddress;
            return true;
        });
}

async function buildDiscoverableRideRoute({ ride, getDirectionsCached }) {
    const plannedWaypoints = buildDiscoverableRouteWaypoints(ride);
    const captainLocation = normalizeRouteCoordinate(ride?.captain?.location);

    if (ride?.status !== 'ongoing' || !captainLocation) {
        const plannedDirectionsRoute = await getDirectionsCached(ride.pickup, ride.destination, plannedWaypoints);

        return {
            routeProfile: buildRouteProfile(plannedDirectionsRoute),
            routeOrigin: ride.pickup,
            routeWaypoints: plannedWaypoints
        };
    }

    const plannedDirectionsRoute = await getDirectionsCached(ride.pickup, ride.destination, plannedWaypoints);
    const plannedRouteProfile = buildRouteProfile(plannedDirectionsRoute);

    if (!plannedRouteProfile) {
        const liveDirectionsRoute = await getDirectionsCached(captainLocation, ride.destination, plannedWaypoints);

        return {
            routeProfile: buildRouteProfile(liveDirectionsRoute),
            routeOrigin: captainLocation,
            routeWaypoints: plannedWaypoints
        };
    }

    const captainProjection = findNearestPointOnRoute(plannedRouteProfile, captainLocation);
    const remainingWaypoints = buildDiscoverableRouteWaypoints(ride, {
        fromRouteDistanceMeters: captainProjection?.routeDistanceMeters || 0,
        origin: captainLocation,
        destination: ride.destination
    });
    const liveDirectionsRoute = await getDirectionsCached(captainLocation, ride.destination, remainingWaypoints);

    return {
        routeProfile: buildRouteProfile(liveDirectionsRoute) || plannedRouteProfile,
        routeOrigin: captainLocation,
        routeWaypoints: remainingWaypoints
    };
}

function projectRouteProgress(hostDistanceMeters, fromStartMeters, toEndMeters) {
    if (hostDistanceMeters <= 0) {
        return {
            progress: 0,
            alignmentRatio: 1
        };
    }

    const forwardProgress = fromStartMeters / hostDistanceMeters;
    const backwardProgress = 1 - (toEndMeters / hostDistanceMeters);
    const progress = clampNumber((forwardProgress + backwardProgress) / 2, 0, 1);
    const alignmentRatio = clampNumber(
        Math.abs((fromStartMeters + toEndMeters) - hostDistanceMeters) / hostDistanceMeters,
        0,
        1
    );

    return {
        progress,
        alignmentRatio
    };
}

function buildRideParticipants(ride, candidateParticipant = null) {
    const ownerId = normalizeObjectId(ride?.user?._id || ride?.user);
    const owner = {
        allocationKey: `owner:${ownerId}`,
        type: 'owner',
        userId: ownerId,
        bookedSeats: Math.max(1, Number(ride?.bookedSeats) || 1),
        pickup: ride.pickup,
        destination: ride.destination
    };

    const passengers = Array.isArray(ride?.passengerAllocations)
        ? ride.passengerAllocations
            .map((allocation) => {
                const userId = normalizeObjectId(allocation?.user?._id || allocation?.user);
                if (!userId || !allocation?.pickup || !allocation?.destination) {
                    return null;
                }

                return {
                    allocationKey: `passenger:${userId}`,
                    type: 'passenger',
                    userId,
                    bookedSeats: Math.max(1, Number(allocation?.bookedSeats) || 1),
                    pickup: allocation.pickup,
                    destination: allocation.destination
                };
            })
            .filter(Boolean)
        : [];

    const participants = [ owner, ...passengers ];

    if (candidateParticipant) {
        participants.push({
            allocationKey: `candidate:${normalizeObjectId(candidateParticipant.userId)}`,
            type: 'candidate',
            userId: normalizeObjectId(candidateParticipant.userId),
            bookedSeats: Math.max(1, Number(candidateParticipant.bookedSeats) || 1),
            pickup: candidateParticipant.pickup,
            destination: candidateParticipant.destination
        });
    }

    return participants;
}

async function buildParticipantSpan({ participant, hostRoute, getDistanceTimeCached }) {
    if (participant.type === 'owner') {
        return {
            ...participant,
            startMeters: 0,
            endMeters: hostRoute.distanceMeters,
            overlapMeters: hostRoute.distanceMeters,
            directDistanceMeters: hostRoute.distanceMeters,
            overlapRatio: 1,
            routeFitRatio: 1,
            startAlignmentRatio: 0,
            endAlignmentRatio: 0
        };
    }

    const [
        startFromHostPickup,
        startToHostDestination,
        endFromHostPickup,
        endToHostDestination,
        directRoute
    ] = await Promise.all([
        getDistanceTimeCached(hostRoute.pickup, participant.pickup),
        getDistanceTimeCached(participant.pickup, hostRoute.destination),
        getDistanceTimeCached(hostRoute.pickup, participant.destination),
        getDistanceTimeCached(participant.destination, hostRoute.destination),
        getDistanceTimeCached(participant.pickup, participant.destination)
    ]);

    const startProjection = projectRouteProgress(
        hostRoute.distanceMeters,
        Number(startFromHostPickup?.distance?.value) || 0,
        Number(startToHostDestination?.distance?.value) || 0
    );
    const endProjection = projectRouteProgress(
        hostRoute.distanceMeters,
        Number(endFromHostPickup?.distance?.value) || 0,
        Number(endToHostDestination?.distance?.value) || 0
    );

    const startMeters = clampNumber(startProjection.progress * hostRoute.distanceMeters, 0, hostRoute.distanceMeters);
    const endMeters = clampNumber(endProjection.progress * hostRoute.distanceMeters, 0, hostRoute.distanceMeters);
    const overlapMeters = Math.max(0, endMeters - startMeters);
    const directDistanceMeters = Number(directRoute?.distance?.value) || 0;
    const startRouteDeviationMeters = Math.max(
        0,
        ((Number(startFromHostPickup?.distance?.value) || 0) + (Number(startToHostDestination?.distance?.value) || 0) - hostRoute.distanceMeters) / 2
    );
    const endRouteDeviationMeters = Math.max(
        0,
        ((Number(endFromHostPickup?.distance?.value) || 0) + (Number(endToHostDestination?.distance?.value) || 0) - hostRoute.distanceMeters) / 2
    );
    const overlapRatio = directDistanceMeters > 0
        ? clampNumber(overlapMeters / directDistanceMeters, 0, 1)
        : 0;

    return {
        ...participant,
        startMeters,
        endMeters,
        overlapMeters,
        directDistanceMeters,
        overlapRatio,
        routeFitRatio: 1 - Math.max(startProjection.alignmentRatio, endProjection.alignmentRatio),
        startAlignmentRatio: startProjection.alignmentRatio,
        endAlignmentRatio: endProjection.alignmentRatio,
        startRouteDeviationMeters,
        endRouteDeviationMeters
    };
}

function buildRouteBoundaries(hostRoute, participantSpans) {
    const rawBoundaries = [
        {
            positionMeters: 0,
            address: hostRoute.pickup
        },
        {
            positionMeters: hostRoute.distanceMeters,
            address: hostRoute.destination
        }
    ];

    participantSpans
        .filter((participant) => participant.type !== 'owner' && participant.overlapMeters > 0)
        .forEach((participant) => {
            rawBoundaries.push({
                positionMeters: participant.startMeters,
                address: participant.pickup
            });
            rawBoundaries.push({
                positionMeters: participant.endMeters,
                address: participant.destination
            });
        });

    const sortedBoundaries = rawBoundaries.sort((left, right) => left.positionMeters - right.positionMeters);

    return sortedBoundaries.reduce((accumulator, boundary) => {
        const previousBoundary = accumulator[ accumulator.length - 1 ];

        if (previousBoundary && Math.abs(previousBoundary.positionMeters - boundary.positionMeters) <= ROUTE_POSITION_EPSILON_METERS) {
            if (!previousBoundary.address && boundary.address) {
                previousBoundary.address = boundary.address;
            }
            return accumulator;
        }

        accumulator.push(boundary);
        return accumulator;
    }, []);
}

async function buildRouteSegments({ hostRoute, boundaries, participantSpans, vehicleType, getDistanceTimeCached }) {
    const segments = await Promise.all(
        boundaries.slice(0, -1).map(async (boundary, index) => {
            const nextBoundary = boundaries[ index + 1 ];
            const projectedDistanceMeters = Math.max(0, nextBoundary.positionMeters - boundary.positionMeters);

            if (projectedDistanceMeters <= ROUTE_POSITION_EPSILON_METERS) {
                return null;
            }

            const segmentDistanceTime = await getDistanceTimeCached(boundary.address, nextBoundary.address);
            const activeParticipants = participantSpans.filter((participant) =>
                participant.startMeters < nextBoundary.positionMeters &&
                participant.endMeters > boundary.positionMeters
            );
            const activeSeatCount = activeParticipants.reduce(
                (sum, participant) => sum + Math.max(1, Number(participant.bookedSeats) || 1),
                0
            );

            if (!activeSeatCount) {
                return null;
            }

            return {
                startMeters: boundary.positionMeters,
                endMeters: nextBoundary.positionMeters,
                distanceMeters: Number(segmentDistanceTime?.distance?.value) || projectedDistanceMeters,
                weight: getFareWeightFromDistanceTime(segmentDistanceTime, vehicleType) || projectedDistanceMeters,
                activeParticipants,
                activeSeatCount
            };
        })
    );

    return segments.filter(Boolean);
}

function summarizeRouteSettlement({ participantSpans, routeSegments, baseRouteFare }) {
    const participantTotals = participantSpans.reduce((accumulator, participant) => {
        accumulator.set(participant.allocationKey, {
            exclusiveFare: 0,
            sharedDistanceMeters: 0,
            exclusiveDistanceMeters: 0
        });
        return accumulator;
    }, new Map());

    routeSegments.forEach((segment) => {
        segment.activeParticipants.forEach((participant) => {
            const seatCount = Math.max(1, Number(participant.bookedSeats) || 1);
            const participantTotalsEntry = participantTotals.get(participant.allocationKey);
            const isSharedSegment = segment.activeSeatCount > seatCount;

            if (isSharedSegment) {
                participantTotalsEntry.sharedDistanceMeters += segment.distanceMeters;
            } else {
                participantTotalsEntry.exclusiveDistanceMeters += segment.distanceMeters;
            }
        });
    });

    const totalOccupiedSeats = participantSpans.reduce(
        (sum, participant) => sum + Math.max(1, Number(participant.bookedSeats) || 1),
        0
    );
    const perSeatFare = totalOccupiedSeats > 0
        ? Number(baseRouteFare) / totalOccupiedSeats
        : 0;

    const participantAllocations = participantSpans.map((participant) => {
        const participantTotalsEntry = participantTotals.get(participant.allocationKey);
        const bookedSeats = Math.max(1, Number(participant.bookedSeats) || 1);
        const sharedDistanceMeters = Math.round(participantTotalsEntry.sharedDistanceMeters);
        const exclusiveDistanceMeters = Math.round(participantTotalsEntry.exclusiveDistanceMeters);
        const totalParticipantDistance = sharedDistanceMeters + exclusiveDistanceMeters;
        const sharedDistanceRatio = totalParticipantDistance > 0
            ? clampNumber(sharedDistanceMeters / totalParticipantDistance, 0, 1)
            : 0;
        const participantFare = perSeatFare * bookedSeats;

        return {
            allocationKey: participant.allocationKey,
            type: participant.type,
            userId: participant.userId,
            bookedSeats,
            pickup: participant.pickup,
            destination: participant.destination,
            fare: Math.round(participantFare),
            farePerSeat: roundToTwoDecimals(perSeatFare),
            sharedFare: Math.round(participantFare * sharedDistanceRatio),
            exclusiveFare: Math.max(0, Math.round(participantFare) - Math.round(participantFare * sharedDistanceRatio)),
            sharedDistanceMeters,
            exclusiveDistanceMeters,
            overlapRatio: clampNumber(
                participant.directDistanceMeters > 0
                    ? sharedDistanceMeters / participant.directDistanceMeters
                    : 0,
                0,
                1
            ),
            routeStartMeters: Math.round(participant.startMeters),
            routeEndMeters: Math.round(participant.endMeters)
        };
    });

    const targetTotalFare = Math.round(baseRouteFare);
    const currentRoundedTotal = participantAllocations.reduce((sum, allocation) => sum + allocation.fare, 0);
    let fareDifference = targetTotalFare - currentRoundedTotal;

    if (fareDifference !== 0 && participantAllocations.length > 0) {
        const adjustmentOrder = [ 'owner', 'passenger', 'candidate' ];
        const sortedAllocations = [ ...participantAllocations ].sort((left, right) => {
            const typeDifference = adjustmentOrder.indexOf(left.type) - adjustmentOrder.indexOf(right.type);
            if (typeDifference !== 0) {
                return typeDifference;
            }
            return right.fare - left.fare;
        });

        let index = 0;
        while (fareDifference !== 0) {
            const allocation = sortedAllocations[ index % sortedAllocations.length ];

            if (fareDifference < 0 && allocation.fare <= 0) {
                index += 1;
                continue;
            }

            allocation.fare += fareDifference > 0 ? 1 : -1;
            fareDifference += fareDifference > 0 ? -1 : 1;
            index += 1;
        }

        sortedAllocations.forEach((allocation) => {
            allocation.farePerSeat = roundToTwoDecimals(allocation.fare / allocation.bookedSeats);
            const totalDistance = Number(allocation.sharedDistanceMeters || 0) + Number(allocation.exclusiveDistanceMeters || 0);
            const sharedRatio = totalDistance > 0
                ? clampNumber(Number(allocation.sharedDistanceMeters || 0) / totalDistance, 0, 1)
                : 0;
            allocation.sharedFare = Math.round(allocation.fare * sharedRatio);
            allocation.exclusiveFare = Math.max(0, allocation.fare - allocation.sharedFare);
        });
    }

    return {
        totalCollectedFare: participantAllocations.reduce((sum, allocation) => sum + allocation.fare, 0),
        participantAllocations
    };
}

async function calculateCarpoolSettlement({ ride, candidateParticipant = null }) {
    const baseRouteFare = getRideBaseRouteFare(ride);
    const vehicleType = normalizeCaptainVehicleType(ride?.captain?.vehicle?.vehicleType) || ride?.vehicleType || 'car';
    const getDistanceTimeCached = createDistanceTimeCache();
    const hostDistanceTime = await getDistanceTimeCached(ride.pickup, ride.destination);
    const hostRoute = {
        pickup: ride.pickup,
        destination: ride.destination,
        distanceMeters: Number(hostDistanceTime?.distance?.value) || 0
    };
    const participants = buildRideParticipants(ride, candidateParticipant);
    const participantSpans = await Promise.all(
        participants.map((participant) =>
            buildParticipantSpan({
                participant,
                hostRoute,
                getDistanceTimeCached
            })
        )
    );

    if (!participantSpans.length) {
        throw new Error('Unable to build carpool participants');
    }

    if (candidateParticipant) {
        const candidateSpan = participantSpans.find((participant) => participant.type === 'candidate');

        if (!candidateSpan || candidateSpan.overlapMeters <= 0 || candidateSpan.endMeters <= candidateSpan.startMeters) {
            const error = new Error('Selected carpool does not overlap with your requested route');
            error.statusCode = 400;
            throw error;
        }
    }

    const boundaries = buildRouteBoundaries(hostRoute, participantSpans);
    const routeSegments = await buildRouteSegments({
        hostRoute,
        boundaries,
        participantSpans,
        vehicleType,
        getDistanceTimeCached
    });

    if (!routeSegments.length) {
        throw new Error('Unable to calculate shared route segments');
    }

    const settlement = summarizeRouteSettlement({
        participantSpans,
        routeSegments,
        baseRouteFare
    });
    const ownerAllocation = settlement.participantAllocations.find((allocation) => allocation.type === 'owner') || null;
    const passengerAllocations = settlement.participantAllocations.filter((allocation) => allocation.type !== 'owner');
    const candidateAllocation = settlement.participantAllocations.find((allocation) => allocation.type === 'candidate') || null;
    const candidateSpan = participantSpans.find((participant) => participant.type === 'candidate') || null;

    return {
        baseRouteFare,
        vehicleType,
        ownerAllocation,
        passengerAllocations,
        candidateAllocation,
        candidateSpan,
        totalCollectedFare: settlement.totalCollectedFare
    };
}

function buildPersistedOwnerAllocation(ride, allocation) {
    return {
        fare: allocation?.fare ?? getRideBaseRouteFare(ride),
        farePerSeat: allocation?.farePerSeat ?? roundToTwoDecimals(getRideBaseRouteFare(ride) / Math.max(1, Number(ride?.bookedSeats) || 1)),
        bookedSeats: allocation?.bookedSeats ?? Math.max(1, Number(ride?.bookedSeats) || 1),
        pickup: allocation?.pickup ?? ride.pickup,
        destination: allocation?.destination ?? ride.destination,
        sharedFare: allocation?.sharedFare ?? 0,
        exclusiveFare: allocation?.exclusiveFare ?? getRideBaseRouteFare(ride),
        sharedDistanceMeters: allocation?.sharedDistanceMeters ?? 0,
        exclusiveDistanceMeters: allocation?.exclusiveDistanceMeters ?? 0,
        overlapRatio: allocation?.overlapRatio ?? 0,
        routeStartMeters: allocation?.routeStartMeters ?? 0,
        routeEndMeters: allocation?.routeEndMeters ?? 0
    };
}

function buildExistingPassengerAllocationsMap(ride) {
    return new Map(
        (Array.isArray(ride?.passengerAllocations) ? ride.passengerAllocations : [])
            .map((allocation) => {
                const userId = normalizeObjectId(allocation?.user?._id || allocation?.user);
                return userId ? [ userId, allocation ] : null;
            })
            .filter(Boolean)
    );
}

function buildPersistedPassengerAllocations(allocations = [], existingAllocationsByUserId = new Map()) {
    return allocations
        .filter((allocation) => allocation?.type !== 'owner')
        .map((allocation) => {
            const normalizedUserId = normalizeObjectId(allocation.userId);
            const currentAllocation = existingAllocationsByUserId.get(normalizedUserId) || null;
            const currentBoardingStatus = getPassengerBoardingStatus(currentAllocation);
            const resolvedBoardingStatus = currentAllocation ? currentBoardingStatus : 'awaiting_pickup';
            const pickupOtp = currentAllocation?.pickupOtp || getOtp(6);

            return {
                user: allocation.userId,
                bookedSeats: allocation.bookedSeats,
                fare: allocation.fare,
                farePerSeat: allocation.farePerSeat,
                sharedFare: allocation.sharedFare,
                exclusiveFare: allocation.exclusiveFare,
                sharedDistanceMeters: allocation.sharedDistanceMeters,
                exclusiveDistanceMeters: allocation.exclusiveDistanceMeters,
                overlapRatio: allocation.overlapRatio,
                routeStartMeters: allocation.routeStartMeters,
                routeEndMeters: allocation.routeEndMeters,
                pickup: allocation.pickup,
                destination: allocation.destination,
                boardingStatus: resolvedBoardingStatus,
                pickupOtp,
                joinedAt: currentAllocation?.joinedAt || new Date(),
                pickedUpAt: resolvedBoardingStatus === 'onboard' ? (currentAllocation?.pickedUpAt || new Date()) : null
            };
        });
}

function buildPricingSummary(allocation) {
    if (!allocation) {
        return null;
    }

    return {
        sharedFare: Number(allocation.sharedFare) || 0,
        exclusiveFare: Number(allocation.exclusiveFare) || 0,
        sharedDistanceMeters: Number(allocation.sharedDistanceMeters) || 0,
        exclusiveDistanceMeters: Number(allocation.exclusiveDistanceMeters) || 0,
        overlapRatio: clampNumber(Number(allocation.overlapRatio) || 0, 0, 1)
    };
}

function buildRouteMatchSummary(routeCompatibility = null, candidateSpan = null, anchorMetrics = {}) {
    if (routeCompatibility) {
        return {
            overlapMeters: Math.round(Number(routeCompatibility.overlapMeters) || 0),
            directDistanceMeters: Math.round(Number(candidateSpan?.directDistanceMeters) || 0),
            overlapRatio: clampNumber(Number(routeCompatibility.overlapRatio) || 0, 0, 1),
            routeFitRatio: routeCompatibility.exactRouteMatch ? 1 : clampNumber(
                1 - ((Number(routeCompatibility.totalDetourMeters) || 0) / Math.max(
                    1,
                    carpoolDiscoveryConfig.maxRouteDeviationMeters * 2
                )),
                0,
                1
            ),
            startRouteDeviationMeters: Math.round(Number(routeCompatibility.pickupDetourMeters) || 0),
            endRouteDeviationMeters: Math.round(Number(routeCompatibility.destinationDetourMeters) || 0),
            maxRouteDeviationMeters: Math.max(
                Math.round(Number(routeCompatibility.pickupDetourMeters) || 0),
                Math.round(Number(routeCompatibility.destinationDetourMeters) || 0)
            ),
            pickupDetourMeters: Math.round(Number(routeCompatibility.pickupDetourMeters) || 0),
            destinationDetourMeters: Math.round(Number(routeCompatibility.destinationDetourMeters) || 0),
            totalDetourMeters: Math.round(Number(routeCompatibility.totalDetourMeters) || 0),
            pickupRouteDistanceMeters: Math.round(Number(routeCompatibility.pickupRouteDistanceMeters) || 0),
            destinationRouteDistanceMeters: Math.round(Number(routeCompatibility.destinationRouteDistanceMeters) || 0),
            pickupProgressRatio: clampNumber(Number(routeCompatibility.pickupProgressRatio) || 0, 0, 1),
            destinationProgressRatio: clampNumber(Number(routeCompatibility.destinationProgressRatio) || 0, 0, 1),
            pickupEtaSeconds: Math.round(Number(routeCompatibility.etaToPickupSeconds) || 0),
            pickupEtaText: routeCompatibility.etaToPickupText || '',
            exactRouteMatch: Boolean(routeCompatibility.exactRouteMatch),
            pickupAnchorDistanceMeters: Math.round(Number(anchorMetrics.pickupDistanceMeters) || 0),
            destinationAnchorDistanceMeters: Math.round(Number(anchorMetrics.destinationDistanceMeters) || 0)
        };
    }

    if (!candidateSpan) {
        return null;
    }

    const startRouteDeviationMeters = Math.round(Number(candidateSpan.startRouteDeviationMeters) || 0);
    const endRouteDeviationMeters = Math.round(Number(candidateSpan.endRouteDeviationMeters) || 0);

    return {
        overlapMeters: Math.round(Number(candidateSpan.overlapMeters) || 0),
        directDistanceMeters: Math.round(Number(candidateSpan.directDistanceMeters) || 0),
        overlapRatio: clampNumber(Number(candidateSpan.overlapRatio) || 0, 0, 1),
        routeFitRatio: clampNumber(Number(candidateSpan.routeFitRatio) || 0, 0, 1),
        startRouteDeviationMeters,
        endRouteDeviationMeters,
        maxRouteDeviationMeters: Math.max(startRouteDeviationMeters, endRouteDeviationMeters),
        pickupAnchorDistanceMeters: Math.round(Number(anchorMetrics.pickupDistanceMeters) || 0),
        destinationAnchorDistanceMeters: Math.round(Number(anchorMetrics.destinationDistanceMeters) || 0)
    };
}

function decorateRideForUser(ride, userId) {
    if (!ride) {
        return ride;
    }

    const rideObject = typeof ride.toObject === 'function'
        ? ride.toObject({ virtuals: true })
        : { ...ride };
    const normalizedViewerId = normalizeObjectId(userId);
    const normalizedOwnerId = normalizeObjectId(rideObject?.user?._id || rideObject?.user);
    const viewerIsOwner = normalizedViewerId === normalizedOwnerId;
    const ownerFallbackAllocation = buildPersistedOwnerAllocation(rideObject, rideObject?.ownerAllocation);
    const passengerAllocation = Array.isArray(rideObject?.passengerAllocations)
        ? rideObject.passengerAllocations.find((allocation) =>
            normalizeObjectId(allocation?.user?._id || allocation?.user) === normalizedViewerId
        )
        : null;
    const viewerAllocation = viewerIsOwner
        ? (rideObject.ownerAllocation || ownerFallbackAllocation)
        : passengerAllocation;
    const viewerBookedSeats = Math.max(
        1,
        Number(viewerAllocation?.bookedSeats) || Number(rideObject?.bookedSeats) || 1
    );
    const viewerBoardingStatus = viewerIsOwner
        ? (rideObject?.status === 'ongoing' ? 'onboard' : 'awaiting_start')
        : getPassengerBoardingStatus(passengerAllocation);
    const viewerOtp = viewerIsOwner
        ? rideObject?.otp || null
        : passengerAllocation?.pickupOtp || null;

    rideObject.totalCollectedFare = Number(rideObject.fare) || 0;
    rideObject.baseRouteFare = getRideBaseRouteFare(rideObject);
    rideObject.viewerRole = viewerIsOwner ? 'owner' : passengerAllocation ? 'passenger' : 'viewer';
    rideObject.viewerFare = viewerAllocation?.fare != null
        ? Number(viewerAllocation.fare)
        : Number(rideObject.fare) || 0;
    rideObject.viewerFarePerSeat = viewerAllocation?.farePerSeat != null
        ? Number(viewerAllocation.farePerSeat)
        : viewerBookedSeats > 0
            ? roundToTwoDecimals((Number(rideObject.fare) || 0) / viewerBookedSeats)
            : null;
    rideObject.viewerBookedSeats = viewerBookedSeats;
    rideObject.viewerPickup = viewerAllocation?.pickup || rideObject.pickup;
    rideObject.viewerDestination = viewerAllocation?.destination || rideObject.destination;
    rideObject.viewerPricingSummary = buildPricingSummary(viewerAllocation || ownerFallbackAllocation);
    rideObject.viewerBoardingStatus = viewerBoardingStatus;
    rideObject.viewerOtp = viewerOtp;
    rideObject.shouldWaitForPickup = shouldViewerWaitForPickup(rideObject, viewerIsOwner, passengerAllocation);
    rideObject.otp = viewerOtp;

    if (!viewerIsOwner && viewerBoardingStatus === 'completed' && rideObject.status === 'ongoing') {
        rideObject.status = 'completed';
    }

    rideObject.passengerAllocations = Array.isArray(rideObject?.passengerAllocations)
        ? rideObject.passengerAllocations.map((allocation) => {
            const isViewerAllocation =
                normalizeObjectId(allocation?.user?._id || allocation?.user) === normalizedViewerId;

            return {
                ...allocation,
                boardingStatus: getPassengerBoardingStatus(allocation),
                pickupOtp: isViewerAllocation ? allocation?.pickupOtp || null : undefined
            };
        })
        : [];

    return rideObject;
}

module.exports.decorateRideForUser = decorateRideForUser;

function formatNearbyRide(
    ride,
    vehicleType,
    vehicleCapacity,
    availableSeats,
    pickupDistanceMeters,
    destinationDistanceMeters,
    pricing,
    candidateSpan = null,
    routeCompatibility = null
) {
    return {
        _id: ride._id.toString(),
        rideId: ride._id.toString(),
        status: ride.status,
        pickup: ride.pickup,
        destination: ride.destination,
        fare: pricing?.fare ?? ride.fare,
        farePerSeat: pricing?.farePerSeat ?? ride.farePerSeat ?? null,
        genderPreference: ride.genderPreference,
        availableSeats,
        captainName: buildCaptainName(ride.captain),
        captainId: ride.captain?._id?.toString(),
        vehicleType,
        vehicleCapacity,
        vehiclePlate: ride.captain?.vehicle?.plate || 'Plate unavailable',
        vehicleColor: ride.captain?.vehicle?.color || '',
        pickupDistanceMeters: Math.round(pickupDistanceMeters),
        destinationDistanceMeters: Math.round(destinationDistanceMeters),
        pricingSummary: buildPricingSummary(pricing),
        routeMatchSummary: buildRouteMatchSummary(routeCompatibility, candidateSpan, {
            pickupDistanceMeters,
            destinationDistanceMeters
        })
    };
}

module.exports.createRide = async ({
    user, pickup, destination, vehicleType, rideType, availableSeats, genderPreference, allowAnyVehicleType
}) => {
    if (!user || !pickup || !destination || !rideType) {
        throw new Error('All fields are required');
    }

    const normalizedRideType = rideType === 'carpool' ? 'carpool' : 'solo';
    const normalizedVehicleType = vehicleType === 'auto' || vehicleType === 'car' || vehicleType === 'moto'
        ? vehicleType
        : null;
    const isFlexibleVehicleRequest = normalizedRideType === 'carpool' && Boolean(allowAnyVehicleType);
    const normalizedGenderPreference = [ 'male', 'female', 'any' ].includes(genderPreference)
        ? genderPreference
        : 'any';
    const resolvedBookedSeats = normalizedRideType === 'carpool'
        ? Math.min(4, Math.max(1, Number(availableSeats) || 1))
        : 1;
    const compatibleVehicleTypes = normalizedRideType === 'carpool'
        ? getCompatibleVehicleTypesForSeats(resolvedBookedSeats)
        : [];

    const fareTable = normalizedRideType === 'carpool'
        ? await calculateCarpoolFare(pickup, destination, resolvedBookedSeats, normalizedRideType)
        : await getFare(pickup, destination);

    if (!normalizedVehicleType && !isFlexibleVehicleRequest) {
        const error = new Error('Invalid vehicle type selected');
        error.statusCode = 400;
        throw error;
    }

    if (normalizedRideType === 'carpool' && !compatibleVehicleTypes.length) {
        const error = new Error('No compatible shared vehicle is available for that seat request');
        error.statusCode = 400;
        throw error;
    }

    if (normalizedRideType === 'carpool' && normalizedVehicleType && !isShareableVehicleType(normalizedVehicleType)) {
        const error = new Error('Selected vehicle cannot be used for carpool');
        error.statusCode = 400;
        throw error;
    }

    if (normalizedRideType === 'carpool' && normalizedVehicleType && vehicleSeatCapacity[ normalizedVehicleType ] < resolvedBookedSeats) {
        const error = new Error('Selected vehicle does not support that many passenger seats');
        error.statusCode = 400;
        throw error;
    }

    const resolvedVehicleType = isFlexibleVehicleRequest ? null : normalizedVehicleType;
    const resolvedBaseRouteFare = isFlexibleVehicleRequest
        ? getStableSharedRouteFareQuote(fareTable)
        : fareTable[ normalizedVehicleType ];
    const resolvedFarePerSeat = normalizedRideType === 'carpool'
        ? roundToTwoDecimals(resolvedBaseRouteFare / resolvedBookedSeats)
        : resolvedBaseRouteFare;
    const resolvedFare = normalizedRideType === 'carpool'
        ? getTotalFareFromPerSeatFare(resolvedFarePerSeat, resolvedBookedSeats)
        : resolvedFarePerSeat;

    return rideModel.create({
        user,
        pickup,
        destination,
        rideType: normalizedRideType,
        vehicleType: resolvedVehicleType,
        allowAnyVehicleType: isFlexibleVehicleRequest,
        genderPreference: normalizedRideType === 'carpool' ? normalizedGenderPreference : 'any',
        availableSeats: resolvedBookedSeats,
        bookedSeats: normalizedRideType === 'carpool' ? resolvedBookedSeats : 1,
        otp: getOtp(6),
        fare: resolvedFare,
        baseRouteFare: normalizedRideType === 'carpool' ? resolvedBaseRouteFare : null,
        farePerSeat: normalizedRideType === 'carpool' ? resolvedFarePerSeat : null,
        ownerAllocation: normalizedRideType === 'carpool'
            ? {
                fare: resolvedFare,
                farePerSeat: resolvedFarePerSeat,
                bookedSeats: resolvedBookedSeats,
                pickup,
                destination,
                sharedFare: 0,
                exclusiveFare: resolvedFare,
                sharedDistanceMeters: 0,
                exclusiveDistanceMeters: 0,
                overlapRatio: 0,
                routeStartMeters: 0,
                routeEndMeters: 0
            }
            : undefined
    });
};

module.exports.confirmRide = async ({
    rideId, captain
}) => {
    if (!rideId) {
        throw new Error('Ride id is required');
    }

    const ride = await rideModel.findById(rideId).populate('user');

    if (!ride) {
        throw new Error('Ride not found');
    }

    if (ride.status !== 'pending') {
        const error = new Error('Ride request is no longer available');
        error.statusCode = 409;
        throw error;
    }

    const captainVehicleType = normalizeCaptainVehicleType(captain?.vehicle?.vehicleType);

    if (!captainVehicleType) {
        const error = new Error('Captain vehicle does not match the requested ride type');
        error.statusCode = 400;
        throw error;
    }

    if (!ride.allowAnyVehicleType && captainVehicleType !== ride.vehicleType) {
        const error = new Error('Captain vehicle does not match the requested ride type');
        error.statusCode = 400;
        throw error;
    }

    if (ride.rideType === 'carpool') {
        if (!isShareableVehicleType(captainVehicleType)) {
            const error = new Error('Captain vehicle cannot be used for carpool');
            error.statusCode = 400;
            throw error;
        }

        const requestedSeatCount = Number(ride.availableSeats || 0);
        const captainCapacity = getCaptainVehicleCapacity(captain);

        if (!captainCapacity) {
            const error = new Error('Captain vehicle details are incomplete');
            error.statusCode = 400;
            throw error;
        }

        if (captainCapacity < requestedSeatCount) {
            const error = new Error('Captain vehicle cannot fulfill this carpool seat request');
            error.statusCode = 400;
            throw error;
        }

        if (ride.allowAnyVehicleType) {
            ride.vehicleType = captainVehicleType;
        }

        const acceptedVehicleFareTable = await getFare(ride.pickup, ride.destination);
        const acceptedVehicleBaseFare = Number(acceptedVehicleFareTable?.[ captainVehicleType ]) || getRideBaseRouteFare(ride);

        ride.baseRouteFare = roundToTwoDecimals(acceptedVehicleBaseFare);
        ride.farePerSeat = roundToTwoDecimals(ride.baseRouteFare / Math.max(1, Number(ride.bookedSeats) || 1));
        ride.fare = getTotalFareFromPerSeatFare(ride.farePerSeat, Math.max(1, Number(ride.bookedSeats) || 1));
        ride.ownerAllocation = buildPersistedOwnerAllocation(ride, {
            fare: ride.fare,
            farePerSeat: ride.farePerSeat,
            bookedSeats: Math.max(1, Number(ride.bookedSeats) || 1),
            pickup: ride.pickup,
            destination: ride.destination,
            sharedFare: 0,
            exclusiveFare: ride.fare,
            sharedDistanceMeters: 0,
            exclusiveDistanceMeters: 0,
            overlapRatio: 0,
            routeStartMeters: 0,
            routeEndMeters: 0
        });
        ride.availableSeats = Math.max(captainCapacity - Math.max(1, Number(ride.bookedSeats) || 1), 0);
    }

    ride.status = 'accepted';
    ride.captain = captain._id;
    ride.rejectedCaptains = [];
    await ride.save();

    return getRideWithDetails(rideId);
};

module.exports.rejectRide = async ({ rideId, captain }) => {
    if (!rideId) {
        throw new Error('Ride id is required');
    }

    const ride = await rideModel.findById(rideId).populate('user');

    if (!ride) {
        throw new Error('Ride not found');
    }

    if (ride.status !== 'pending') {
        const error = new Error('Ride request is already handled');
        error.statusCode = 409;
        throw error;
    }

    const captainId = normalizeObjectId(captain?._id);
    const rejectedCaptains = Array.isArray(ride.rejectedCaptains) ? ride.rejectedCaptains : [];
    const requestedCaptains = Array.isArray(ride.requestedCaptains) ? ride.requestedCaptains : [];

    if (!Array.isArray(ride.rejectedCaptains)) {
        ride.rejectedCaptains = rejectedCaptains;
    }
    const alreadyRejected = rejectedCaptains.some((rejectedCaptainId) =>
        normalizeObjectId(rejectedCaptainId) === captainId
    );

    if (!alreadyRejected) {
        ride.rejectedCaptains.push(captain._id);
    }

    const requestedCaptainIds = requestedCaptains.map(normalizeObjectId);
    const rejectedCaptainIds = ride.rejectedCaptains.map(normalizeObjectId);
    const allRequestedCaptainsRejected =
        requestedCaptainIds.length > 0 &&
        requestedCaptainIds.every((requestedCaptainId) => rejectedCaptainIds.includes(requestedCaptainId));

    if (allRequestedCaptainsRejected) {
        ride.status = 'rejected';
    }

    await ride.save();

    return {
        ride: await getRideWithDetails(rideId),
        allRequestedCaptainsRejected
    };
};

module.exports.startRide = async ({ rideId, otp, captain }) => {
    if (!rideId || !otp) {
        throw new Error('Ride id and OTP are required');
    }

    if (!captain?._id) {
        throw new Error('Captain is required');
    }

    const ride = await getRideWithDetails({
        _id: rideId,
        captain: captain._id
    });

    if (!ride) {
        throw new Error('Ride not found');
    }

    if (ride.status !== 'accepted') {
        throw new Error('Ride not accepted');
    }

    if (ride.otp !== otp) {
        throw new Error('Invalid OTP');
    }

    ride.status = 'ongoing';
    await ride.save();

    return getRideWithDetails(rideId);
};

module.exports.endRide = async ({ rideId, captain }) => {
    if (!rideId) {
        throw new Error('Ride id is required');
    }

    const ride = await getRideWithDetails({
        _id: rideId,
        captain: captain._id
    });

    if (!ride) {
        throw new Error('Ride not found');
    }

    if (ride.status !== 'ongoing') {
        throw new Error('Ride not ongoing');
    }

    ride.status = 'completed';
    ride.completedAt = new Date();

    if (Array.isArray(ride.passengerAllocations)) {
        ride.passengerAllocations.forEach((allocation) => {
            if (getPassengerBoardingStatus(allocation) === 'onboard') {
                allocation.boardingStatus = 'completed';
            }
        });
    }

    await ride.save();

    return getRideWithDetails(rideId);
};

module.exports.getMatchingCarpools = async ({ userId, pickup, destination, genderPreference = 'any', bookedSeats = 1 }) => {
    if (!pickup || !destination) {
        throw new Error('Pickup and destination are required');
    }

    const normalizedPreference = [ 'male', 'female', 'any' ].includes(genderPreference)
        ? genderPreference
        : 'any';
    const requestedSeatCount = Math.max(1, Number(bookedSeats) || 1);
    const getDistanceTimeCached = createDistanceTimeCache();
    const getDirectionsCached = createDirectionsCache();

    const [ pickupCoordinates, destinationCoordinates, candidateDirectDistanceTime ] = await Promise.all([
        mapService.getAddressCoordinate(pickup),
        mapService.getAddressCoordinate(destination),
        getDistanceTimeCached(pickup, destination)
    ]);
    const candidateDirectDistanceMeters = Number(candidateDirectDistanceTime?.distance?.value) || 0;

    const candidateRides = await rideModel.find({
        rideType: 'carpool',
        status: { $in: discoverableCarpoolRideStatuses },
        captain: { $ne: null },
        user: { $ne: userId },
        passengers: { $ne: userId }
    }).populate('captain').populate('user').lean();

    const matchedRides = (await Promise.all(candidateRides.map(async (ride) => {
        if (!ride.captain || !isCaptainCurrentlyAvailableForCarpool(ride.captain)) {
            return null;
        }

        if (!matchesGenderPreference(ride.genderPreference, normalizedPreference)) {
            return null;
        }

        const vehicleType = normalizeCaptainVehicleType(ride.captain?.vehicle?.vehicleType);
        const vehicleCapacity = getCaptainVehicleCapacity(ride.captain);

        if (!vehicleType || !vehicleCapacity || !isShareableVehicleType(vehicleType)) {
            return null;
        }

        const availableSeats = getCurrentAvailableSeats(ride, vehicleCapacity);

        if (availableSeats <= 0 || availableSeats < requestedSeatCount) {
            return null;
        }

        let routeProfile;

        try {
            const discoverableRoute = await buildDiscoverableRideRoute({
                ride,
                getDirectionsCached
            });
            routeProfile = discoverableRoute?.routeProfile || null;
        } catch (error) {
            return null;
        }

        if (!routeProfile) {
            return null;
        }

        const ridePickupCoordinates = routeProfile.coordinates[ 0 ] || await mapService.getAddressCoordinate(ride.pickup);
        const rideDestinationCoordinates =
            routeProfile.coordinates[ routeProfile.coordinates.length - 1 ] ||
            await mapService.getAddressCoordinate(ride.destination);
        const pickupDistanceMeters = mapService.calculateDistanceInMeters(pickupCoordinates, ridePickupCoordinates);
        const destinationDistanceMeters = mapService.calculateDistanceInMeters(destinationCoordinates, rideDestinationCoordinates);
        let routeCompatibility = buildRouteCompatibility({
            routeProfile,
            pickupCoordinate: pickupCoordinates,
            destinationCoordinate: destinationCoordinates,
            candidateDirectDistanceMeters
        });

        if (!routeCompatibility) {
            return null;
        }

        const matchesDestinationCompatibility =
            routeCompatibility.destinationDetourMeters <= carpoolDiscoveryConfig.maxRouteDeviationMeters;
        const matchesPickupDetour =
            routeCompatibility.pickupDetourMeters <= carpoolDiscoveryConfig.maxRouteDeviationMeters;
        const matchesRouteOverlap =
            routeCompatibility.overlapMeters >= carpoolDiscoveryConfig.minOverlapDistanceMeters ||
            routeCompatibility.overlapRatio >= carpoolDiscoveryConfig.minOverlapRatio;
        const maintainsForwardTripOrder =
            routeCompatibility.destinationRouteDistanceMeters >
            routeCompatibility.pickupRouteDistanceMeters;

        if (
            !matchesDestinationCompatibility ||
            !matchesPickupDetour ||
            !matchesRouteOverlap ||
            !maintainsForwardTripOrder
        ) {
            return null;
        }

        if (ride.captain?.location?.ltd != null && ride.captain?.location?.lng != null) {
            try {
                const captainToPickupDistanceTime = await getDistanceTimeCached(
                    `${ride.captain.location.ltd},${ride.captain.location.lng}`,
                    pickup
                );
                const pickupEtaSeconds = Number(captainToPickupDistanceTime?.duration?.value) || routeCompatibility.etaToPickupSeconds;

                routeCompatibility = {
                    ...routeCompatibility,
                    etaToPickupSeconds: pickupEtaSeconds,
                    etaToPickupText: captainToPickupDistanceTime?.duration?.text || formatDurationText(pickupEtaSeconds)
                };
            } catch (error) {
                routeCompatibility = {
                    ...routeCompatibility,
                    etaToPickupText: routeCompatibility.etaToPickupText || formatDurationText(routeCompatibility.etaToPickupSeconds)
                };
            }
        }

        let settlement;

        try {
            settlement = await calculateCarpoolSettlement({
                ride,
                candidateParticipant: {
                    userId,
                    pickup,
                    destination,
                    bookedSeats: requestedSeatCount
                }
            });
        } catch (error) {
            return null;
        }

        if (!settlement.candidateAllocation) {
            return null;
        }

        const candidateSpan = settlement.candidateSpan;
        const routeMatchSummary = buildRouteMatchSummary(routeCompatibility, candidateSpan, {
            pickupDistanceMeters,
            destinationDistanceMeters
        });

        if (!routeMatchSummary) {
            return null;
        }

        return formatNearbyRide(
            ride,
            vehicleType,
            vehicleCapacity,
            availableSeats,
            pickupDistanceMeters,
            destinationDistanceMeters,
            settlement.candidateAllocation,
            candidateSpan,
            routeCompatibility
        );
    })))
        .filter(Boolean)
        .sort((left, right) => {
            const leftExactMatchRank = left?.routeMatchSummary?.exactRouteMatch ? 0 : 1;
            const rightExactMatchRank = right?.routeMatchSummary?.exactRouteMatch ? 0 : 1;

            if (leftExactMatchRank !== rightExactMatchRank) {
                return leftExactMatchRank - rightExactMatchRank;
            }

            const leftTotalDetourMeters = Number(left?.routeMatchSummary?.totalDetourMeters) || Number.POSITIVE_INFINITY;
            const rightTotalDetourMeters = Number(right?.routeMatchSummary?.totalDetourMeters) || Number.POSITIVE_INFINITY;

            if (leftTotalDetourMeters !== rightTotalDetourMeters) {
                return leftTotalDetourMeters - rightTotalDetourMeters;
            }

            const leftOverlapRatio = Number(left?.routeMatchSummary?.overlapRatio) || 0;
            const rightOverlapRatio = Number(right?.routeMatchSummary?.overlapRatio) || 0;

            if (rightOverlapRatio !== leftOverlapRatio) {
                return rightOverlapRatio - leftOverlapRatio;
            }

            const leftPickupEtaSeconds = Number(left?.routeMatchSummary?.pickupEtaSeconds) || Number.POSITIVE_INFINITY;
            const rightPickupEtaSeconds = Number(right?.routeMatchSummary?.pickupEtaSeconds) || Number.POSITIVE_INFINITY;

            if (leftPickupEtaSeconds !== rightPickupEtaSeconds) {
                return leftPickupEtaSeconds - rightPickupEtaSeconds;
            }

            if (left.fare !== right.fare) {
                return left.fare - right.fare;
            }

            return left.pickupDistanceMeters - right.pickupDistanceMeters;
        });

    const groupedBuckets = matchedRides.reduce((accumulator, ride) => {
        const bucket = accumulator.get(ride.availableSeats) || {
            availableSeats: ride.availableSeats,
            nearbyVehicleCount: 0,
            rides: []
        };

        bucket.nearbyVehicleCount += 1;
        bucket.rides.push(ride);
        accumulator.set(ride.availableSeats, bucket);

        return accumulator;
    }, new Map());

    const seatBuckets = Array.from(groupedBuckets.values()).sort((left, right) => right.availableSeats - left.availableSeats);

    return {
        totalVehicles: matchedRides.length,
        seatBuckets
    };
};

module.exports.joinCarpoolRide = async ({ rideId, userId, pickup, destination, bookedSeats }) => {
    if (!rideId || !userId || !pickup || !destination) {
        throw new Error('Ride id, user, pickup and destination are required');
    }

    const ride = await getRideWithDetails({
        _id: rideId,
        rideType: 'carpool',
        captain: { $ne: null }
    });

    if (!ride) {
        const error = new Error('Selected carpool is no longer available');
        error.statusCode = 404;
        throw error;
    }

    if (!joinableCarpoolRideStatuses.includes(ride.status)) {
        const error = new Error('Selected carpool is no longer available');
        error.statusCode = 404;
        throw error;
    }

    if (ride.user?._id?.toString() === userId.toString()) {
        const error = new Error('You already own this carpool ride');
        error.statusCode = 400;
        throw error;
    }

    if ((ride.passengers || []).some((passenger) => normalizeObjectId(passenger?._id || passenger) === userId.toString())) {
        const error = new Error('You have already joined this carpool ride');
        error.statusCode = 400;
        throw error;
    }

    const vehicleCapacity = getCaptainVehicleCapacity(ride.captain);
    const currentAvailableSeats = getCurrentAvailableSeats(ride, vehicleCapacity);
    const requestedSeats = Math.max(1, Number(bookedSeats) || 1);

    if (currentAvailableSeats < requestedSeats) {
        const error = new Error('No seats are available in this carpool now');
        error.statusCode = 400;
        throw error;
    }

    const settlement = await calculateCarpoolSettlement({
        ride,
        candidateParticipant: {
            userId,
            pickup,
            destination,
            bookedSeats: requestedSeats
        }
    });

    ride.passengers = [
        ...new Set([
            ...(ride.passengers || []).map((passenger) => normalizeObjectId(passenger?._id || passenger)),
            userId.toString()
        ])
    ];
    const existingPassengerAllocationsByUserId = buildExistingPassengerAllocationsMap(ride);
    ride.baseRouteFare = settlement.baseRouteFare;
    ride.fare = settlement.totalCollectedFare;
    ride.ownerAllocation = buildPersistedOwnerAllocation(ride, settlement.ownerAllocation);
    ride.farePerSeat = ride.ownerAllocation.farePerSeat;
    ride.passengerAllocations = buildPersistedPassengerAllocations(
        settlement.passengerAllocations,
        existingPassengerAllocationsByUserId
    );
    ride.availableSeats = Math.max(vehicleCapacity - getOccupiedSeatCount({
        bookedSeats: ride.bookedSeats,
        passengerAllocations: ride.passengerAllocations
    }), 0);
    await ride.save();

    return getRideWithDetails(rideId);
};

module.exports.confirmPassengerPickup = async ({ rideId, passengerId, otp, captain }) => {
    if (!rideId || !passengerId || !otp) {
        throw new Error('Ride id, passenger id and OTP are required');
    }

    const ride = await getRideWithDetails({
        _id: rideId,
        captain: captain?._id,
        rideType: 'carpool'
    });

    if (!ride) {
        const error = new Error('Ride not found');
        error.statusCode = 404;
        throw error;
    }

    if (ride.status !== 'ongoing') {
        const error = new Error('Passenger pickup can only be confirmed during an ongoing ride');
        error.statusCode = 400;
        throw error;
    }

    const normalizedPassengerId = normalizeObjectId(passengerId);
    const allocation = Array.isArray(ride.passengerAllocations)
        ? ride.passengerAllocations.find((entry) =>
            normalizeObjectId(entry?.user?._id || entry?.user) === normalizedPassengerId
        )
        : null;

    if (!allocation) {
        const error = new Error('Passenger allocation not found for this ride');
        error.statusCode = 404;
        throw error;
    }

    if (getPassengerBoardingStatus(allocation) === 'onboard') {
        return getRideWithDetails(rideId);
    }

    if (String(allocation?.pickupOtp || '') !== String(otp || '')) {
        const error = new Error('Invalid pickup OTP for this passenger');
        error.statusCode = 400;
        throw error;
    }

    allocation.boardingStatus = 'onboard';
    allocation.pickedUpAt = new Date();
    await ride.save();

    return getRideWithDetails(rideId);
};

module.exports.completePassengerDropoff = async ({ rideId, passengerId, captain }) => {
    if (!rideId || !passengerId) {
        throw new Error('Ride id and passenger id are required');
    }

    const ride = await getRideWithDetails({
        _id: rideId,
        captain: captain?._id,
        rideType: 'carpool'
    });

    if (!ride) {
        const error = new Error('Ride not found');
        error.statusCode = 404;
        throw error;
    }

    if (ride.status !== 'ongoing') {
        const error = new Error('Passenger dropoff can only be completed during an ongoing ride');
        error.statusCode = 400;
        throw error;
    }

    const normalizedPassengerId = normalizeObjectId(passengerId);
    const allocation = Array.isArray(ride.passengerAllocations)
        ? ride.passengerAllocations.find((entry) =>
            normalizeObjectId(entry?.user?._id || entry?.user) === normalizedPassengerId
        )
        : null;

    if (!allocation) {
        const error = new Error('Passenger allocation not found for this ride');
        error.statusCode = 404;
        throw error;
    }

    const currentStatus = getPassengerBoardingStatus(allocation);

    if (currentStatus === 'completed') {
        return getRideWithDetails(rideId);
    }

    if (currentStatus !== 'onboard') {
        const error = new Error('Only onboard passengers can be marked as dropped off');
        error.statusCode = 400;
        throw error;
    }

    allocation.boardingStatus = 'completed';
    await ride.save();

    return getRideWithDetails(rideId);
};
