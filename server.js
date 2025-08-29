const http = require('http');
const app = require('./app');
const { initializeSocket } = require('./socket');

const port = process.env.PORT || 5000; // Use 5000 for backend instead of 3000 (frontend often uses 3000)

// Create HTTP server
const server = http.createServer(app);

// Initialize WebSocket/Socket.io
initializeSocket(server);

// Start server
server.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port} in ${process.env.NODE_ENV || 'development'} mode`);
});
