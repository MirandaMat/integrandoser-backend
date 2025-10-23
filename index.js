// server/index.js
const dotenv = require('dotenv');
dotenv.config(); // Load environment variables first

const express = require('express');
const cors = require('cors');
const path = require('path');
const { createServer } = require('http');
// const { Server } = require('socket.io'); // Socket.IO Server still commented out
// const { initializeSocket, getUserSocket } = require('./src/socketHandlers.js'); // Socket handlers still commented out

// --- Restore ALL Route Imports ---
const authRoutes = require('./src/routes/authRoutes.js');
const usersRoutes = require('./src/routes/usersRoutes.js');
const profileRoutes = require('./src/routes/profileRoutes.js');
const agendaRoutes = require('./src/routes/agendaRoutes.js');
const messagesRoutes = require('./src/routes/messagesRoutes.js');
const contentRoutes = require('./src/routes/contentRoutes'); //
const triagemRoutes = require('./src/routes/triagemRoutes.js');
const schedulingRoutes = require('./src/routes/schedulingRoutes.js');
const financeRoutes = require('./src/routes/financeRoutes'); //
const notesRoutes = require('./src/routes/notesRoutes.js'); //
const dreamRoutes = require('./src/routes/dreamRoutes.js'); //
const notificationsRoutes = require('./src/routes/notificationsRoutes.js'); //
const calendarRoutes = require('./src/routes/calendarRoutes.js'); //
// --- End Restore ---

const app = express();
const port = process.env.PORT || 3001; // Use PORT from environment or fallback

// CORS configuration
const allowedOrigins = [
    'http://localhost:5173', // Your local frontend
    'https://integrandoser.integrandoser.com.br' // Your production frontend domain
];
const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps, curl requests, or same-origin requests)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    credentials: true // Important for cookies, authorization headers with HTTPS
};
app.use(cors(corsOptions));
// Handle preflight requests for all routes
app.options('*', cors(corsOptions));

// Middleware to parse JSON bodies
app.use(express.json());

// Create the HTTP server
const httpServer = createServer(app);

/* // Socket.IO setup remains commented out for now
const io = new Server(httpServer, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    }
});
app.set('io', io); // Store io instance for access in routes
app.set('getUserSocket', getUserSocket); // Store getUserSocket function
initializeSocket(io); // Initialize socket event listeners and middleware
*/

// --- Restore ALL API Routes ---
app.use('/api/auth', authRoutes); //
app.use('/api/users', usersRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/agenda', agendaRoutes); //
app.use('/api/messages', messagesRoutes); //
app.use('/api/content', contentRoutes); //
app.use('/api/triagem', triagemRoutes);
app.use('/api/scheduling', schedulingRoutes);
app.use('/api/finance', financeRoutes); //
app.use('/api/notes', notesRoutes); //
app.use('/api/dreams', dreamRoutes); //
app.use('/api/notifications', notificationsRoutes); //
app.use('/api/calendar', calendarRoutes); //
// --- End Restore ---

// --- Simple Health Check Route ---
app.get('/', (req, res) => {
  console.log('[HEALTH CHECK] Root route / accessed.');
  res.status(200).send('Server (API routes only) is running OK!');
});
// --- End Health Check ---

// Serve static files from the 'uploads' directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- Global Error Handlers ---
process.on('uncaughtException', (error) => {
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  console.error('[FATAL] Uncaught Exception:', error);
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  // Consider graceful shutdown: process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  // Consider graceful shutdown: process.exit(1);
});

// --- HTTP Server Error Listeners ---
httpServer.on('error', (error) => {
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  console.error('[FATAL] HTTP Server Error Event:', error);
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
});

httpServer.on('clientError', (err, socket) => {
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  console.error('[FATAL] HTTP Client Error Event:', err);
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  // Ensure socket is destroyed after logging
  if (socket.writable) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  }
  socket.destroy(err);
});
// --- End HTTP Server Error Listeners ---

// Start the server, listening on all interfaces (0.0.0.0)
httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Server with API routes running on port ${port}, listening on 0.0.0.0`);
});