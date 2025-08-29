const rideModel = require('../models/ride.model');
const mapService = require('./maps.service');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

async function calculateCarpoolFare(pickup, destination, availableSeats,rideType) {
    if (!pickup || !destination || !availableSeats) {
        throw new Error('Pickup, destination and available seats are required');
    }

    // Validate seat count
    if (availableSeats < 2 || availableSeats > 7) {
        throw new Error('Carpool must have 2-4 available seats');
    }
    const baseFare = {
        auto: 30,
        car: 50,
        moto: 20
    };

    const perKmRate = {
        auto: 10,
        car: 15,
        moto: 8
    };

    const perMinuteRate = {
        auto: 2,
        car: 3,
        moto: 1.5
    };


    // Get base fares for all vehicle types
    const distanceTime = await mapService.getDistanceTime(pickup, destination);
    const soloFares = {
        auto: Math.round(baseFare.auto + 
              ((distanceTime.distance.value / 1000) * perKmRate.auto) + 
              ((distanceTime.duration.value / 60) * perMinuteRate.auto)),
        car: Math.round(baseFare.car + 
              ((distanceTime.distance.value / 1000) * perKmRate.car) + 
              ((distanceTime.duration.value / 60) * perMinuteRate.car)),
        moto: Math.round(baseFare.moto + 
              ((distanceTime.distance.value / 1000) * perKmRate.moto) + 
              ((distanceTime.duration.value / 60) * perMinuteRate.moto))
    };

    if (rideType === 'solo') {
        return soloFares;
    }

    // Carpool pricing configuration
    const carpoolConfig = {
        discountPerPassenger: 0.15, // 15% discount per additional passenger
        minDiscount: 0.10,         // Minimum 10% discount
        maxDiscount: 0.35,         // Maximum 35% discount
        vehicleMultipliers: {       // Vehicle type adjustments
            auto: 0.9,             // Autos get 10% less discount
            car: 1.0,              // Cars get full discount
            moto: 0.7              // Motos get 30% less discount
        }
    };

    // Calculate carpool fares for each vehicle type
    const carpoolFares = {
        auto: Math.round(soloFares.auto * (1 - Math.min(
            carpoolConfig.maxDiscount,
            Math.max(
                carpoolConfig.minDiscount,
                carpoolConfig.discountPerPassenger * (availableSeats - 1)
            ) * carpoolConfig.vehicleMultipliers.auto
        ))),
        car: Math.round(soloFares.car * (1 - Math.min(
            carpoolConfig.maxDiscount,
            Math.max(
                carpoolConfig.minDiscount,
                carpoolConfig.discountPerPassenger * (availableSeats - 1)
            ) * carpoolConfig.vehicleMultipliers.car
        ))),
        moto: Math.round(soloFares.moto * (1 - Math.min(
            carpoolConfig.maxDiscount,
            Math.max(
                carpoolConfig.minDiscount,
                carpoolConfig.discountPerPassenger * (availableSeats - 1)
            ) * carpoolConfig.vehicleMultipliers.moto
        )))
    };

    return carpoolFares;
}

module.exports.calculateCarpoolFare = calculateCarpoolFare;


async function getFare(pickup, destination) {

    if (!pickup || !destination) {
        throw new Error('Pickup and destination are required');
    }

    const distanceTime = await mapService.getDistanceTime(pickup, destination);

    const baseFare = {
        auto: 30,
        car: 50,
        moto: 20
    };

    const perKmRate = {
        auto: 10,
        car: 15,
        moto: 8
    };

    const perMinuteRate = {
        auto: 2,
        car: 3,
        moto: 1.5
    };



    const fare = {
        auto: Math.round(baseFare.auto + ((distanceTime.distance.value / 1000) * perKmRate.auto) + ((distanceTime.duration.value / 60) * perMinuteRate.auto)),
        car: Math.round(baseFare.car + ((distanceTime.distance.value / 1000) * perKmRate.car) + ((distanceTime.duration.value / 60) * perMinuteRate.car)),
        moto: Math.round(baseFare.moto + ((distanceTime.distance.value / 1000) * perKmRate.moto) + ((distanceTime.duration.value / 60) * perMinuteRate.moto))
    };

    return fare;


}

module.exports.getFare = getFare;


function getOtp(num) {
    function generateOtp(num) {
        const otp = crypto.randomInt(Math.pow(10, num - 1), Math.pow(10, num)).toString();
        return otp;
    }
    return generateOtp(num);
}


module.exports.createRide = async ({
    user, pickup, destination, vehicleType,rideType
}) => {
    if (!user || !pickup || !destination || !vehicleType) {
        throw new Error('All fields are required');
    }
    if(rideType=='carpool')availableSeats=3;

    const fare = rideType=='carpool'
    ? await calculateCarpoolFare(pickup, destination,availableSeats,rideType)
    : await getFare(pickup, destination);
    // const fare = await getFare(pickup, destination);

    console.log(fare);

    const ride = rideModel.create({
        user,
        pickup,
        destination,
        rideType,
        otp: getOtp(6),
        fare: fare[ vehicleType ]
    })

    return ride;
}

module.exports.confirmRide = async ({
    rideId, captain
}) => {
    if (!rideId) {
        throw new Error('Ride id is required');
    }

    await rideModel.findOneAndUpdate({
        _id: rideId
    }, {
        status: 'accepted',
        captain: captain._id
    })

    const ride = await rideModel.findOne({
        _id: rideId
    }).populate('user').populate('captain').select('+otp');

    if (!ride) {
        throw new Error('Ride not found');
    }

    return ride;

}

module.exports.startRide = async ({ rideId, otp, captain }) => {
    if (!rideId || !otp) {
        throw new Error('Ride id and OTP are required');
    }

    const ride = await rideModel.findOne({
        _id: rideId
    }).populate('user').populate('captain').select('+otp');

    if (!ride) {
        throw new Error('Ride not found');
    }

    if (ride.status !== 'accepted') {
        throw new Error('Ride not accepted');
    }

    if (ride.otp !== otp) {
        throw new Error('Invalid OTP');
    }

    await rideModel.findOneAndUpdate({
        _id: rideId
    }, {
        status: 'ongoing'
    })

    return ride;
}

module.exports.endRide = async ({ rideId, captain }) => {
    if (!rideId) {
        throw new Error('Ride id is required');
    }

    const ride = await rideModel.findOne({
        _id: rideId,
        captain: captain._id
    }).populate('user').populate('captain').select('+otp');

    if (!ride) {
        throw new Error('Ride not found');
    }

    if (ride.status !== 'ongoing') {
        throw new Error('Ride not ongoing');
    }

    await rideModel.findOneAndUpdate({
        _id: rideId
    }, {
        status: 'completed'
    })

    return ride;
}

async function findMatchingCarpools({ pickup, destination, genderPreference }) {
    const pickupCoord = await mapService.getAddressCoordinate(pickup);
    const destinationCoord = await mapService.getAddressCoordinate(destination);
  
    const carpools = await rideModel.find({
      rideType: 'carpool',
      genderPreference: { $in: ['any', genderPreference] },
      availableSeats: { $gt: 0 }
    }).populate('user passengers');
  
    return carpools.filter(ride => {
      const isPickupNear = mapService.isClose(ride.pickup, pickupCoord);
      const isDestinationNear = mapService.isClose(ride.destination, destinationCoord);
      return isPickupNear && isDestinationNear;
    });
  }
  

