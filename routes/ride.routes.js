const express = require('express');
const router = express.Router();
const { body, query } = require('express-validator');
const rideController = require('../controllers/ride.controller');
const authMiddleware = require('../middlewares/auth.middleware');


router.post('/create',
    authMiddleware.authUser,
    body('pickup').isString().isLength({ min: 3 }).withMessage('Invalid pickup address'),
    body('destination').isString().isLength({ min: 3 }).withMessage('Invalid destination address'),
    body('rideType').isString().isIn([ 'solo', 'carpool' ]).withMessage('Invalid vehicle type'),
    body('vehicleType')
      .optional({ nullable: true })
      .isString()
      .isIn([ 'auto', 'car', 'moto' ])
      .withMessage('Invalid vehicle type'),
    body('allowAnyVehicleType')
      .optional()
      .isBoolean()
      .withMessage('Invalid flexible vehicle request flag'),
    body('availableSeats')
      .optional()
      .isInt({ min: 1, max: 4 })
      .withMessage('Carpool seats must be between 1 and 4'),
    body('genderPreference')
      .optional()
      .isString()
      .isIn([ 'male', 'female', 'any' ])
      .withMessage('Invalid gender preference'),
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
    query('availableSeats').isInt({ min: 1, max: 4 }).withMessage('Seats must be 1-4'),
    query('rideType').isString().isIn([ 'carpool' ]).withMessage('Invalid vehicle type'),
    rideController.calculateCarpoolFare
);

router.get('/carpool-options',
    authMiddleware.authUser,
    query('pickup').isString().isLength({ min: 3 }).withMessage('Invalid pickup address'),
    query('destination').isString().isLength({ min: 3 }).withMessage('Invalid destination address'),
    query('genderPreference').optional().isString().isIn([ 'male', 'female', 'any' ]).withMessage('Invalid gender preference'),
    query('availableSeats').optional().isInt({ min: 1, max: 4 }).withMessage('Carpool seats must be between 1 and 4'),
    rideController.getMatchingCarpools
)

router.post('/join-carpool',
    authMiddleware.authUser,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    body('pickup').isString().isLength({ min: 3 }).withMessage('Invalid pickup address'),
    body('destination').isString().isLength({ min: 3 }).withMessage('Invalid destination address'),
    body('bookedSeats').optional().isInt({ min: 1, max: 4 }).withMessage('Booked seats must be between 1 and 4'),
    rideController.joinCarpoolRide
)

router.get('/status',
    authMiddleware.authUser,
    query('rideId').isMongoId().withMessage('Invalid ride id'),
    rideController.getRideStatus
)

router.post('/confirm',
    authMiddleware.authCaptain,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    rideController.confirmRide
)

router.post('/reject',
    authMiddleware.authCaptain,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    rideController.rejectRide
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

router.post('/confirm-passenger-pickup',
    authMiddleware.authCaptain,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    body('passengerId').isMongoId().withMessage('Invalid passenger id'),
    body('otp').isString().isLength({ min: 6, max: 6 }).withMessage('Invalid OTP'),
    rideController.confirmPassengerPickup
)

router.post('/complete-passenger-dropoff',
    authMiddleware.authCaptain,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    body('passengerId').isMongoId().withMessage('Invalid passenger id'),
    rideController.completePassengerDropoff
)



module.exports = router;
