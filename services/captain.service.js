const captainModel = require('../models/captain.model');

const maxVehicleCapacityByType = {
    car: 4,
    motorcycle: 1,
    auto: 3
};

module.exports.createCaptain = async ({
    firstname, lastname, email, password, color, plate, capacity, vehicleType
}) => {
    if (!firstname || !email || !password || !color || !plate || !capacity || !vehicleType) {
        throw new Error('All fields are required');
    }

    const normalizedVehicleType = String(vehicleType || '').trim().toLowerCase();
    const supportedCapacity = maxVehicleCapacityByType[ normalizedVehicleType ] || Number(capacity) || 1;
    const normalizedCapacity = Math.min(Math.max(1, Number(capacity) || 1), supportedCapacity);

    const captain = captainModel.create({
        fullname: {
            firstname,
            lastname
        },
        email,
        password,
        vehicle: {
            color,
            plate,
            capacity: normalizedCapacity,
            vehicleType
        }
    })

    return captain;
}
