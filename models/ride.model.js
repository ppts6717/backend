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

    status: {
        type: String,
        enum: [ 'pending', 'accepted', "ongoing", 'completed', 'cancelled' ],
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
    genderPreference: {
        type: String,
        enum: ['male', 'female', 'any'],
        default: 'any'
    },
    availableSeats: {
        type: Number,
        default: 1
    },
      passengers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }]
      
})

rideSchema.index({ pickupCoordinates: '2dsphere' });
rideSchema.index({ destinationCoordinates: '2dsphere' });
rideSchema.index({ rideType: 1, status: 1 });

module.exports = mongoose.model('ride', rideSchema);