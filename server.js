const http = require('http');
const path = require('path');
const dotenv = require('dotenv');
const app = require('./app');
const { initializeSocket } = require('./socket');

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '.env') });

const port = process.env.PORT || 5000;

// 🟢 Create HTTP server
const server = http.createServer(app);

// 🟢 Initialize Socket.io with the created server
initializeSocket(server);

// 🟢 Start listening
server.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
});
