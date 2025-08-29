const { body } = require('express-validator');

module.exports = {
  createRide: [
    body('pickup').isString().notEmpty(),
    body('destination').isString().notEmpty(),
    body('vehicleType').isIn(['auto', 'car', 'moto']),
    body('rideType').optional().isIn(['solo', 'carpool']),
    body('availableSeats').optional().isInt({ min: 1, max: 4 })
  ]
};