// server/src/socketHandlers.js
const jwt = require('jsonwebtoken');
const userSockets = new Map();

function initializeSocket(io) {
    // --- START: TEMPORARY SIMPLIFICATION FOR DEBUGGING ---
    io.use((socket, next) => {
        let token = socket.handshake.auth.token;
        
        console.log('[Socket Auth DEBUG] Received connection attempt.'); // Log attempt
        
        if (token) {
            if (token.startsWith('Bearer ')) {
                token = token.split(' ')[1];
            }
            jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
                if (err) {
                    console.warn('[Socket Auth DEBUG] Invalid token received, but allowing connection for testing:', err.message);
                    // Instead of rejecting, attach a default/guest user object
                    socket.user = { userId: 'guest_' + socket.id, role: 'GUEST' }; 
                    next(); // Allow connection even with bad token
                } else {
                    console.log('[Socket Auth DEBUG] Valid token verified. Attaching user.');
                    socket.user = decoded; // Attach real user data
                    next(); // Allow connection
                }
            });
        } else {
            console.warn('[Socket Auth DEBUG] No token received, allowing connection as guest for testing.');
             // Instead of rejecting, attach a default/guest user object
            socket.user = { userId: 'guest_' + socket.id, role: 'GUEST' }; 
            next(); // Allow connection even without token
        }
    });
    // --- END: TEMPORARY SIMPLIFICATION ---

    io.on('connection', (socket) => {
        // Use a fallback if socket.user wasn't attached properly (shouldn't happen with the code above)
        const userId = socket.user?.userId || 'unknown_' + socket.id; 
        const userRole = socket.user?.role || 'UNKNOWN';

        console.log(`Socket connected: ${socket.id} (User ID: ${userId}, Role: ${userRole})`); // Log role too

        // Use toString() safely
        const userIdStr = userId.toString();
        userSockets.set(userIdStr, socket.id);

        socket.on('disconnect', () => {
            console.log(`Socket disconnected: ${socket.id} (User ID: ${userId})`);
            if (userSockets.get(userIdStr) === socket.id) {
                userSockets.delete(userIdStr);
            }
        });

        // Add a basic test event listener
        socket.on('ping', (callback) => {
          console.log(`[Socket Event] Received ping from ${userId}`);
          if (typeof callback === 'function') {
            callback('pong'); // Send acknowledgment back
          }
        });
    });
}

function getUserSocket(userId) {
    // Use toString() safely
    return userSockets.get(userId.toString());
}

module.exports = { initializeSocket, getUserSocket };