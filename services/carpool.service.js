// services/carpool.service.js
const Carpool = require('../models/carpool.model');
const User = require('../models/user.model');

exports.createCarpool = async (data) => {
  return await Carpool.create(data);
};

exports.findMatchingCarpools = async ({ pickup, destination, genderPreference }) => {
  const query = {
    'route.pickup': pickup,
    'route.destination': destination,
    seatsAvailable: { $gt: 0 },
  };

  if (genderPreference && genderPreference !== 'any') {
    query.genderPreference = { $in: [genderPreference, 'any'] };
  }

  return await Carpool.find(query).populate('captainId').populate('passengers');
};

exports.joinCarpool = async (carpoolId, userId) => {
  const carpool = await Carpool.findById(carpoolId);

  if (!carpool || carpool.seatsAvailable <= 0) throw new Error('No seats available');

  carpool.passengers.push(userId);
  carpool.seatsAvailable -= 1;

  await carpool.save();
  return carpool;
};
