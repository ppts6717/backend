const express = require('express');
const router = express.Router();
const { body, query } = require('express-validator');
const rideController = require('../controllers/ride.controller');
const authMiddleware = require('../middlewares/auth.middleware');


router.post('/create',
    authMiddleware.authUser,
    body('pickup').isString().isLength({ min: 3 }).withMessage('Invalid pickup address'),
    body('destination').isString().isLength({ min: 3 }).withMessage('Invalid destination address'),
    body('vehicleType').isString().isIn([ 'auto', 'car', 'moto' ]).withMessage('Invalid vehicle type'),
    body('rideType').isString().isIn([ 'solo', 'carpool' ]).withMessage('Invalid vehicle type'),
    // body('availableSeats')
    //   .isInt({ min: 1, max: 7 })
    //   .withMessage('Carpool must have 2-4 seats'),
    rideController.createRide
)

router.get('/get-fare',
    authMiddleware.authUser,
    query('pickup').isString().isLength({ min: 3 }).withMessage('Invalid pickup address'),
    query('destination').isString().isLength({ min: 3 }).withMessage('Invalid destination address'),
    query('rideType').isString().isIn([ 'solo' ]).withMessage('Invalid vehicle type'),
    rideController.getFare
)

router.get('/carPoolFare',
    authMiddleware.authUser,
    query('pickup').isString().isLength({ min: 3 }),
    query('destination').isString().isLength({ min: 3 }),
    query('availableSeats').isInt({ min: 1, max: 7 }).withMessage('Seats must be 1-7'),
    query('rideType').isString().isIn([ 'carpool' ]).withMessage('Invalid vehicle type'),
    rideController.calculateCarpoolFare
);

router.post('/confirm',
    authMiddleware.authCaptain,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    rideController.confirmRide
)

router.get('/start-ride',
    authMiddleware.authCaptain,
    query('rideId').isMongoId().withMessage('Invalid ride id'),
    query('otp').isString().isLength({ min: 6, max: 6 }).withMessage('Invalid OTP'),
    rideController.startRide
)

router.post('/end-ride',
    authMiddleware.authCaptain,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    rideController.endRide
)



module.exports = router;