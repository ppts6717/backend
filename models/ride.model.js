const mongoose = require('mongoose');


const rideSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true
    },
    captain: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'captain',
    },
    pickup: {
        type: String,
        required: true,
    },
    destination: {
        type: String,
        required: true,
    },
    fare: {
        type: Number,
        required: true,
    },
    baseRouteFare: {
        type: Number,
        default: null,
        min: 0,
    },
    farePerSeat: {
        type: Number,
        default: null,
    },
    bookedSeats: {
        type: Number,
        default: 1,
        min: 1,
    },

    status: {
        type: String,
        enum: [ 'pending', 'accepted', "ongoing", 'completed', 'cancelled', 'rejected' ],
        default: 'pending',
    },

    duration: {
        type: Number,
    }, // in seconds

    distance: {
        type: Number,
    }, // in meters

    paymentID: {
        type: String,
    },
    orderId: {
        type: String,
    },
    signature: {
        type: String,
    },
    completedAt: {
        type: Date,
        default: null,
    },

    otp: {
        type: String,
        select: false,
        required: true,
    },
    // rideType: {
    //     type: String,
    //     enum: ['solo', 'carpool'],
    //     // required: true,
    //     default: 'solo'
    // },
    // availableSeats: {
    //     type: Number,
    //     min: 1,
    //     max: 7,
    //     default: 1
    // },
    rideType: {
        type: String,
        enum: ['solo', 'carpool'],
        required: true
    },
    vehicleType: {
        type: String,
        enum: ['auto', 'car', 'moto'],
        default: null
    },
    allowAnyVehicleType: {
        type: Boolean,
        default: false
    },
    genderPreference: {
        type: String,
        enum: ['male', 'female', 'any'],
        default: 'any'
    },
    availableSeats: {
        type: Number,
        default: 1
    },
    ownerAllocation: {
        fare: {
            type: Number,
            default: null,
            min: 0
        },
        farePerSeat: {
            type: Number,
            default: null,
            min: 0
        },
        bookedSeats: {
            type: Number,
            default: 1,
            min: 1
        },
        pickup: {
            type: String,
            default: null
        },
        destination: {
            type: String,
            default: null
        },
        sharedFare: {
            type: Number,
            default: 0,
            min: 0
        },
        exclusiveFare: {
            type: Number,
            default: 0,
            min: 0
        },
        sharedDistanceMeters: {
            type: Number,
            default: 0,
            min: 0
        },
        exclusiveDistanceMeters: {
            type: Number,
            default: 0,
            min: 0
        },
        overlapRatio: {
            type: Number,
            default: 0,
            min: 0,
            max: 1
        },
        routeStartMeters: {
            type: Number,
            default: 0,
            min: 0
        },
        routeEndMeters: {
            type: Number,
            default: 0,
            min: 0
        }
    },
    passengers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user'
    }],
    passengerAllocations: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'user',
            required: true
        },
        bookedSeats: {
            type: Number,
            required: true,
            min: 1
        },
        fare: {
            type: Number,
            required: true,
            min: 0
        },
        farePerSeat: {
            type: Number,
            required: true,
            min: 0
        },
        sharedFare: {
            type: Number,
            default: 0,
            min: 0
        },
        exclusiveFare: {
            type: Number,
            default: 0,
            min: 0
        },
        sharedDistanceMeters: {
            type: Number,
            default: 0,
            min: 0
        },
        exclusiveDistanceMeters: {
            type: Number,
            default: 0,
            min: 0
        },
        overlapRatio: {
            type: Number,
            default: 0,
            min: 0,
            max: 1
        },
        routeStartMeters: {
            type: Number,
            default: 0,
            min: 0
        },
        routeEndMeters: {
            type: Number,
            default: 0,
            min: 0
        },
        pickup: {
            type: String,
            required: true
        },
        destination: {
            type: String,
            required: true
        },
        boardingStatus: {
            type: String,
            enum: ['awaiting_pickup', 'onboard', 'completed'],
            default: 'awaiting_pickup'
        },
        pickupOtp: {
            type: String,
            default: null
        },
        joinedAt: {
            type: Date,
            default: Date.now
        },
        pickedUpAt: {
            type: Date,
            default: null
        }
    }],
    requestedCaptains: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'captain'
    }],
    rejectedCaptains: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'captain'
    }]
}, {
    timestamps: true
})

rideSchema.index({ pickupCoordinates: '2dsphere' });
rideSchema.index({ destinationCoordinates: '2dsphere' });
rideSchema.index({ rideType: 1, status: 1 });

module.exports = mongoose.model('ride', rideSchema);
