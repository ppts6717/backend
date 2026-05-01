const captainController = require('../controllers/captain.controller');
const express = require('express');
const router = express.Router();
const { body } = require("express-validator")
const authMiddleware = require('../middlewares/auth.middleware');


router.post('/register', [
    body('email').isEmail().withMessage('Invalid Email'),
    body('fullname.firstname').isLength({ min: 3 }).withMessage('First name must be at least 3 characters long'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
    body('vehicle.color').isLength({ min: 3 }).withMessage('Color must be at least 3 characters long'),
    body('vehicle.plate').isLength({ min: 3 }).withMessage('Plate must be at least 3 characters long'),
    body('vehicle.capacity')
      .isInt({ min: 1 })
      .withMessage('Capacity must be at least 1')
      .custom((value, { req }) => {
        const vehicleType = String(req.body?.vehicle?.vehicleType || '').trim().toLowerCase();
        const maxCapacityByType = {
          car: 4,
          motorcycle: 1,
          auto: 3,
        };
        const maxCapacity = maxCapacityByType[vehicleType];

        if (!maxCapacity) {
          return true;
        }

        if (Number(value) > maxCapacity) {
          throw new Error(`Capacity for ${vehicleType} cannot exceed ${maxCapacity}`);
        }

        return true;
      }),
    body('vehicle.vehicleType').isIn([ 'car', 'motorcycle', 'auto' ]).withMessage('Invalid vehicle type')
],
    captainController.registerCaptain
)


router.post('/login', [
    body('email').isEmail().withMessage('Invalid Email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long')
],
    captainController.loginCaptain
)


router.get('/profile', authMiddleware.authCaptain, captainController.getCaptainProfile)

router.patch(
    '/status',
    authMiddleware.authCaptain,
    body('status').isIn([ 'active', 'inactive' ]).withMessage('Invalid captain status'),
    captainController.updateCaptainAvailability
)

router.get('/logout', authMiddleware.authCaptain, captainController.logoutCaptain)


module.exports = router;
