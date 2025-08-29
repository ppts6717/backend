const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const connectToDb = require('./db/db');
const userRoutes = require('./routes/user.routes');
const captainRoutes = require('./routes/captain.routes');
const mapsRoutes = require('./routes/maps.routes');
const rideRoutes = require('./routes/ride.routes');
const carpoolRoutes = require('./routes/carpool.routes');

const app = express();

// Connect to DB
connectToDb();

// --- CORS Setup ---
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000'
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// --- Routes ---
app.get('/', (req, res) => {
  res.send('Hello World from Tripzzy Backend 🚀');
});

app.use('/api/users', userRoutes);
app.use('/api/captains', captainRoutes);
app.use('/api/maps', mapsRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/carpools', carpoolRoutes);

// --- Error Handler ---
app.use((err, req, res, next) => {
  if (res.headersSent) {
    console.error('Headers already sent:', err);
    return next(err);
  }
  
  console.error('Server error:', err.stack);
  res.status(500).json({
    message: process.env.NODE_ENV === 'development'
      ? err.message
      : 'Internal server error'
  });
});

module.exports = app;
