const socketIo = require('socket.io');
const userModel = require('./models/user.model');
const captainModel = require('./models/captain.model');
const carpoolModel = require('./models/carpool.model');

let io;

function initializeSocket(server) {
  io = socketIo(server, {
    cors: {
      origin: [
        'http://localhost:5173',             // local dev
        'https://tripzzyride.web.app',       // Firebase Hosting
        'https://tripzzy.onrender.com'       // backend domain
      ],
      methods: ['GET', 'POST'],
      credentials: true
    },
    transports: ['websocket', 'polling'], // ensure fallback works
  });

  io.on('connection', (socket) => {
    console.log(`✅ Client connected: ${socket.id}`);

    // 🟢 Handle user or captain joining socket
    socket.on('join', async (data) => {
      const { userId, userType } = data || {};
      console.log(`📩 Join request from ${userType} - ID: ${userId}, Socket: ${socket.id}`);

      try {
        if (!userId || !userType) {
          return socket.emit('error', { message: 'Invalid join payload' });
        }

        if (userType === 'user') {
          await userModel.findByIdAndUpdate(userId, { socketId: socket.id });
        } else if (userType === 'captain') {
          await captainModel.findByIdAndUpdate(userId, { socketId: socket.id });
        }

        socket.emit('join-success', { message: '✅ Successfully joined socket server' });
      } catch (error) {
        console.error('❌ Error updating user socket ID:', error);
        socket.emit('error', { message: 'Database error' });
      }
    });

    // 🟢 Handle captain location updates
    socket.on('update-location-captain', async (data) => {
      const { userId, location } = data || {};

      if (!userId || !location || !location.ltd || !location.lng) {
        return socket.emit('error', { message: 'Invalid location data' });
      }

      try {
        await captainModel.findByIdAndUpdate(userId, {
          location: { ltd: location.ltd, lng: location.lng }
        });

        // Optional: notify all connected users
        io.emit('captain-location-updated', { userId, location });

        socket.emit('update-success', { message: '📍 Location updated successfully' });
      } catch (error) {
        console.error('❌ Error updating location:', error);
        socket.emit('error', { message: 'Database error' });
      }
    });

    // 🟢 Carpooling Feature: Create a Carpool
    socket.on('create-carpool', async (data) => {
      const { captainId, route, seatsAvailable } = data || {};

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
        console.error('❌ Error creating carpool:', error);
        socket.emit('error', { message: 'Database error' });
      }
    });

    // 🟢 Carpooling Feature: Join a Carpool
    socket.on('join-carpool', async (data) => {
      const { carpoolId, userId, userName } = data || {};

      try {
        const carpool = await carpoolModel.findById(carpoolId);
        if (!carpool) return socket.emit('error', { message: 'Carpool not found' });

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
        console.error('❌ Error joining carpool:', error);
        socket.emit('error', { message: 'Database error' });
      }
    });

    // 🟢 Disconnect Event
    socket.on('disconnect', async () => {
      console.log(`⚠️ Client disconnected: ${socket.id}`);
      try {
        await userModel.updateMany({ socketId: socket.id }, { $unset: { socketId: 1 } });
        await captainModel.updateMany({ socketId: socket.id }, { $unset: { socketId: 1 } });
      } catch (error) {
        console.error('❌ Error clearing socket ID:', error);
      }
    });
  });
}

// 🟢 Utility function to send direct notifications
const sendMessageToSocketId = (socketId, messageObject) => {
  console.log(`📤 Sending message to socket ${socketId}:`, messageObject);

  if (!io) {
    return console.error('❌ Socket.io not initialized.');
  }

  const socket = io.sockets.sockets.get(socketId);
  if (socket) {
    socket.emit(messageObject.event, messageObject.data);
  } else {
    console.warn(`⚠️ Socket ID ${socketId} not found (user might be offline).`);
  }
};

module.exports = { initializeSocket, sendMessageToSocketId };
