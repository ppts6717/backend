const captainModel = require('../models/captain.model');
const captainService = require('../services/captain.service');
const blackListTokenModel = require('../models/blacklistToken.model.js');
const rideModel = require('../models/ride.model');
const { validationResult } = require('express-validator');

const buildCaptainProfile = async (captainId) => {
    const captain = await captainModel.findById(captainId);

    if (!captain) {
        return null;
    }

    const [ completedRides, ongoingRides, acceptedRides ] = await Promise.all([
        rideModel.find({
            captain: captainId,
            status: 'completed',
            completedAt: { $ne: null }
        }).select('fare'),
        rideModel.countDocuments({
            captain: captainId,
            status: 'ongoing'
        }),
        rideModel.countDocuments({
            captain: captainId,
            status: 'accepted'
        })
    ]);

    const totalEarnings = completedRides.reduce((sum, ride) => sum + (Number(ride.fare) || 0), 0);

    return {
        ...captain.toObject(),
        stats: {
            totalEarnings,
            completedTrips: completedRides.length,
            ongoingTrips: ongoingRides,
            pendingTrips: acceptedRides,
            statsMode: 'strict-completed-rides-only'
        }
    };
};


module.exports.registerCaptain = async (req, res, next) => {

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { fullname, email, password, vehicle } = req.body;

    const isCaptainAlreadyExist = await captainModel.findOne({ email });

    if (isCaptainAlreadyExist) {
        return res.status(400).json({ message: 'Captain already exist' });
    }


    const hashedPassword = await captainModel.hashPassword(password);

    const captain = await captainService.createCaptain({
        firstname: fullname.firstname,
        lastname: fullname.lastname,
        email,
        password: hashedPassword,
        color: vehicle.color,
        plate: vehicle.plate,
        capacity: vehicle.capacity,
        vehicleType: vehicle.vehicleType
    });

    const token = captain.generateAuthToken();

    res.status(201).json({ token, captain });

}

module.exports.loginCaptain = async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    const captain = await captainModel.findOne({ email }).select('+password');

    if (!captain) {
        return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isMatch = await captain.comparePassword(password);

    if (!isMatch) {
        return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = captain.generateAuthToken();

    res.cookie('token', token);

    res.status(200).json({ token, captain });
}

module.exports.getCaptainProfile = async (req, res, next) => {
    const captain = await buildCaptainProfile(req.captain._id);

    res.status(200).json({
        captain
    });
}

module.exports.updateCaptainAvailability = async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const nextStatus = String(req.body?.status || '').trim().toLowerCase() === 'active'
        ? 'active'
        : 'inactive';
    const update = nextStatus === 'inactive'
        ? { $set: { status: nextStatus }, $unset: { socketId: 1 } }
        : { $set: { status: nextStatus } };

    await captainModel.findByIdAndUpdate(req.captain._id, update);

    const captain = await buildCaptainProfile(req.captain._id);

    return res.status(200).json({
        captain
    });
}

module.exports.logoutCaptain = async (req, res, next) => {
    const token = req.cookies.token || req.headers.authorization?.split(' ')[ 1 ];

    await blackListTokenModel.create({ token });
    await captainModel.findByIdAndUpdate(req.captain._id, {
        $set: { status: 'inactive' },
        $unset: { socketId: 1 }
    });

    res.clearCookie('token');

    res.status(200).json({ message: 'Logout successfully' });
}
