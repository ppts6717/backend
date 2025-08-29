// validators/carpool.validator.js
const { query } = require('express-validator');

exports.validateCarpoolMatchInput = [
  query('pickup').notEmpty().withMessage('Pickup is required'),
  query('destination').notEmpty().withMessage('Destination is required'),
  query('genderPreference').isIn(['male', 'female', 'any']).withMessage('Invalid gender preference'),
];
