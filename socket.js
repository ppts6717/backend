const socketIo = require('socket.io');
const userModel = require('./models/user.model');
const captainModel = require('./models/captain.model');
const carpoolModel = require('./models/carpool.model'); // Import carpool model

let io;

function initializeSocket(server) {
    io = socketIo(server, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        }
    });

    io.on('connection', (socket) => {
        console.log(`Client connected: ${socket.id}`);

        // Store user socket ID when they join
        socket.on('join', async (data) => {
            const { userId, userType } = data;

            try {
                if (userType === 'user') {
                    await userModel.findByIdAndUpdate(userId, { socketId: socket.id });
                } else if (userType === 'captain') {
                    await captainModel.findByIdAndUpdate(userId, { socketId: socket.id });
                }

                socket.emit('join-success', { message: 'Successfully joined socket server' });
            } catch (error) {
                console.error('Error updating user socket ID:', error);
                socket.emit('error', { message: 'Database error' });
            }
        });

        // Update captain location
        socket.on('update-location-captain', async (data) => {
            const { userId, location } = data;

            if (!location || !location.ltd || !location.lng) {
                return socket.emit('error', { message: 'Invalid location data' });
            }

            try {
                await captainModel.findByIdAndUpdate(userId, {
                    location: { ltd: location.ltd, lng: location.lng }
                });

                io.emit('captain-location-updated', { userId, location });

                socket.emit('update-success', { message: 'Location updated successfully' });
            } catch (error) {
                console.error('Error updating location:', error);
                socket.emit('error', { message: 'Database error' });
            }
        });

        // ✅ Carpooling Feature: Create a Carpool
        socket.on('create-carpool', async (data) => {
            const { captainId, route, seatsAvailable } = data;

            try {
                const carpool = new carpoolModel({
                    captainId,
                    route,
                    seatsAvailable,
                    passengers: []
                });

                await carpool.save();

                io.emit('carpool-updated', { message: 'New carpool available!', carpool });

                socket.emit('carpool-created', { message: 'Carpool created successfully!', carpool });
            } catch (error) {
                console.error('Error creating carpool:', error);
                socket.emit('error', { message: 'Database error' });
            }
        });

        // ✅ Carpooling Feature: Join a Carpool
        socket.on('join-carpool', async (data) => {
            const { carpoolId, userId, userName } = data;

            try {
                const carpool = await carpoolModel.findById(carpoolId);

                if (!carpool) {
                    return socket.emit('error', { message: 'Carpool not found' });
                }

                if (carpool.seatsAvailable > 0) {
                    carpool.passengers.push({ userId, name: userName });
                    carpool.seatsAvailable -= 1;
                    await carpool.save();

                    io.emit('carpool-updated', { message: 'Carpool updated!', carpool });

                    socket.emit('joined-carpool', { message: 'Successfully joined carpool!', carpool });
                } else {
                    socket.emit('error', { message: 'No seats available' });
                }
            } catch (error) {
                console.error('Error joining carpool:', error);
                socket.emit('error', { message: 'Database error' });
            }
        });

        socket.on('disconnect', () => {
            console.log(`Client disconnected: ${socket.id}`);
        });
    });
}

// Function to send a direct message to a specific socket ID
const sendMessageToSocketId = (socketId, messageObject) => {
    console.log("Sending message via socket:", messageObject);

    if (io) {
        io.to(socketId).emit(messageObject.event, messageObject.data);
    } else {
        console.log('Socket.io not initialized.');
    }
}

module.exports = { initializeSocket, sendMessageToSocketId };
