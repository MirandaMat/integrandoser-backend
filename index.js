// server/index.js
const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { createServer } = require('http');
// const { Server } = require('socket.io'); // <-- Comment out Socket.IO Server
// const { initializeSocket, getUserSocket } = require('./src/socketHandlers.js'); // <-- Comment out socket handlers

// --- Temporarily Comment Out ALL Route Imports ---
/*
const authRoutes = require('./src/routes/authRoutes.js');
const usersRoutes = require('./src/routes/usersRoutes.js');
const profileRoutes = require('./src/routes/profileRoutes.js');
const agendaRoutes = require('./src/routes/agendaRoutes.js');
const messagesRoutes = require('./src/routes/messagesRoutes.js');
const contentRoutes = require('./src/routes/contentRoutes');
const triagemRoutes = require('./src/routes/triagemRoutes.js');
const schedulingRoutes = require('./src/routes/schedulingRoutes.js');
const financeRoutes = require('./src/routes/financeRoutes');
const notesRoutes = require('./src/routes/notesRoutes.js');
const dreamRoutes = require('./src/routes/dreamRoutes.js');
const notificationsRoutes = require('./src/routes/notificationsRoutes.js');
const calendarRoutes = require('./src/routes/calendarRoutes.js');
*/
// --- End Comment Out ---

const app = express();
const port = process.env.PORT || 3001;

// Keep CORS configuration
const allowedOrigins = [
    'http://localhost:5173',
    'https://integrandoser.integrandoser.com.br'
];
const corsOptions = {
    origin: function (origin, callback) {
        if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
};
app.use(cors(corsOptions));

app.use(express.json());

// Create the HTTP server (without Socket.IO for now)
const httpServer = createServer(app);
/* // <-- Comment out Socket.IO setup
const io = new Server(httpServer, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    }
});
app.set('io', io);
app.set('getUserSocket', getUserSocket);
initializeSocket(io);
*/ // <-- End Comment Out

// --- Temporarily Comment Out ALL API Routes ---
/*
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/agenda', agendaRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/triagem', triagemRoutes);
app.use('/api/scheduling', schedulingRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/notes', notesRoutes);
app.use('/api/dreams', dreamRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/calendar', calendarRoutes);
*/
// --- End Comment Out ---

// --- Add a Simple Health Check Route ---
app.get('/', (req, res) => {
  console.log('[HEALTH CHECK] Root route / accessed.'); // Add log
  res.status(200).send('Server is running OK!');
});
// --- End Health Check ---

// Keep static files (if needed, otherwise comment out too)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Keep global error handlers
process.on('uncaughtException', (error) => { /* ... */ });
process.on('unhandledRejection', (reason, promise) => { /* ... */ });
httpServer.on('error', (error) => { /* ... */ });
httpServer.on('clientError', (err, socket) => { /* ... */ });

// Start the server
httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Minimal server running on port ${port} listening on 0.0.0.0`); // Modified log
});