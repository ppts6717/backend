const userModel = require('../models/user.model');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const blackListTokenModel =require('../models/blacklistToken.model.js');

const captainModel = require('../models/captain.model');

function getTokenFromRequest(req) {
    return req.cookies.token || req.headers.authorization?.split(' ')[ 1 ];
}

async function isTokenBlacklisted(token) {
    return blackListTokenModel.findOne({ token: token });
}

async function decodeToken(token) {
    return jwt.verify(token, process.env.JWT_SECRET);
}

module.exports.authUser = async (req, res, next) => {
    const token = getTokenFromRequest(req);

    if (!token) {
        return res.status(401).json({ message: 'Unauthorized' });
    }


    const isBlacklisted = await isTokenBlacklisted(token);

    if (isBlacklisted) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {

        const decoded = await decodeToken(token);
        const user = await userModel.findById(decoded._id);

        if (!user) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        req.user = user;

        return next();

    } catch (err) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
}

module.exports.authCaptain = async (req, res, next) => {
    const token = getTokenFromRequest(req);


    if (!token) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    const isBlacklisted = await isTokenBlacklisted(token);



    if (isBlacklisted) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        const decoded = await decodeToken(token);
        const captain = await captainModel.findById(decoded._id);

        if (!captain) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        req.captain = captain;

        return next();
    } catch (err) {
        console.log(err);

        res.status(401).json({ message: 'Unauthorized' });
    }
}

module.exports.authUserOrCaptain = async (req, res, next) => {
    const token = getTokenFromRequest(req);

    if (!token) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    const isBlacklisted = await isTokenBlacklisted(token);

    if (isBlacklisted) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        const decoded = await decodeToken(token);
        const [ user, captain ] = await Promise.all([
            userModel.findById(decoded._id),
            captainModel.findById(decoded._id)
        ]);

        if (user) {
            req.user = user;
            req.authRole = 'user';
            return next();
        }

        if (captain) {
            req.captain = captain;
            req.authRole = 'captain';
            return next();
        }

        return res.status(401).json({ message: 'Unauthorized' });
    } catch (err) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
}
