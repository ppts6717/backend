const socketIo = require('socket.io');
const userModel = require('./models/user.model');
const captainModel = require('./models/captain.model');
const carpoolModel = require('./models/carpool.model');

let io;

function initializeSocket(server) {
  io = socketIo(server, {
    cors: {
      origin: [
        'http://localhost:5173',
        'https://tripzzyride.web.app',
      ],
      methods: ['GET', 'POST'],
      credentials: true,
    },
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('join', async (data) => {
      const { userId, userType } = data || {};
      console.log(`Join request from ${userType} - ID: ${userId}, Socket: ${socket.id}`);

      try {
        if (!userId || !userType) {
          return socket.emit('error', { message: 'Invalid join payload' });
        }

        if (userType === 'user') {
          await userModel.findByIdAndUpdate(userId, { socketId: socket.id });
        } else if (userType === 'captain') {
          await captainModel.findByIdAndUpdate(userId, { socketId: socket.id, status: 'active' });
        }

        socket.emit('join-success', { message: 'Joined socket server successfully' });
      } catch (error) {
        console.error('Error updating socket ID:', error);
        socket.emit('error', { message: 'Database error' });
      }
    });

    socket.on('update-location-captain', async (data) => {
      const { userId, location } = data || {};

      if (!userId || location?.ltd == null || location?.lng == null) {
        return socket.emit('error', { message: 'Invalid location data' });
      }

      try {
        await captainModel.findByIdAndUpdate(userId, {
          location: { ltd: location.ltd, lng: location.lng },
        });

        io.emit('captain-location-updated', { userId, location });
        socket.emit('update-success', { message: 'Location updated successfully' });
      } catch (error) {
        console.error('Error updating location:', error);
        socket.emit('error', { message: 'Database error' });
      }
    });

    socket.on('create-carpool', async (data) => {
      const { captainId, route, seatsAvailable } = data || {};

      try {
        const carpool = new carpoolModel({
          captainId,
          route,
          seatsAvailable,
          passengers: [],
        });

        await carpool.save();

        io.emit('carpool-updated', { message: 'New carpool available!', carpool });
        socket.emit('carpool-created', { message: 'Carpool created successfully!', carpool });
      } catch (error) {
        console.error('Error creating carpool:', error);
        socket.emit('error', { message: 'Database error' });
      }
    });

    socket.on('join-carpool', async (data) => {
      const { carpoolId, userId, userName } = data || {};

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
          socket.emit('joined-carpool', { message: 'Joined carpool successfully!', carpool });
        } else {
          socket.emit('error', { message: 'No seats available' });
        }
      } catch (error) {
        console.error('Error joining carpool:', error);
        socket.emit('error', { message: 'Database error' });
      }
    });

    socket.on('new-ride', (data) => {
      console.log('New ride event received:', data);
      io.emit('new-ride', data);
    });

    socket.on('disconnect', async () => {
      console.log(`Client disconnected: ${socket.id}`);

      try {
        await userModel.updateMany({ socketId: socket.id }, { $unset: { socketId: 1 } });
        await captainModel.updateMany(
          { socketId: socket.id },
          { $unset: { socketId: 1 }, $set: { status: 'inactive' } }
        );
      } catch (error) {
        console.error('Error clearing socket ID:', error);
      }
    });
  });
}

const sendMessageToSocketId = (socketId, messageObject) => {
  if (!io) {
    console.error('Socket.io not initialized');
    return false;
  }

  const socket = io.sockets.sockets.get(socketId);

  if (!socket) {
    console.warn(`Socket ID ${socketId} not found`);
    return false;
  }

  socket.emit(messageObject.event, messageObject.data);
  return true;
};

const isSocketConnected = (socketId) => {
  if (!io || !socketId) {
    return false;
  }

  return io.sockets.sockets.has(socketId);
};

module.exports = { initializeSocket, sendMessageToSocketId, isSocketConnected };
