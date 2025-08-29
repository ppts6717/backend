const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const cors = require('cors');
const app = express();
const cookieParser = require('cookie-parser');
const connectToDb = require('./db/db');
const userRoutes = require('./routes/user.routes');
const captainRoutes = require('./routes/captain.routes');
const mapsRoutes = require('./routes/maps.routes');
const rideRoutes = require('./routes/ride.routes');
const carpoolRoutes = require('./routes/carpool.routes')

connectToDb();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());


app.get('/', (req, res) => {
    res.send('Hello World');
});

app.use('/users', userRoutes);
app.use('/captains', captainRoutes);
app.use('/maps', mapsRoutes);
app.use('/rides', rideRoutes);
app.use('/carpools', carpoolRoutes);


// Add this after all your routes:
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

