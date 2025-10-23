// server/src/socketHandlers.js
const jwt = require('jsonwebtoken');
const userSockets = new Map(); // Armazena { userId: socketId }

function initializeSocket(io) {
    // Middleware de autenticação do Socket.IO (versão de produção)
    io.use((socket, next) => {
        let token = socket.handshake.auth.token;
        
        console.log('[Socket Auth] Received connection attempt.');

        if (token) {
            // Limpa o 'Bearer ' se ele existir
            if (token.startsWith('Bearer ')) {
                token = token.split(' ')[1];
            }

            jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
                if (err) {
                    console.warn(`[Socket Auth] Invalid token. Connection REJECTED. Error: ${err.message}`);
                    return next(new Error('Authentication error: Invalid token.'));
                } else {
                    console.log(`[Socket Auth] Valid token for User ID: ${decoded.userId}. Connection allowed.`);
                    socket.user = decoded; // Anexa os dados do usuário (ex: { userId: 1, role: 'PACIENTE' })
                    next(); // Permite a conexão
                }
            });
        } else {
            console.warn('[Socket Auth] No token provided. Connection REJECTED.');
            next(new Error('Authentication error: No token provided.'));
        }
    });

    io.on('connection', (socket) => {
        // Se chegou aqui, o usuário está autenticado pelo middleware
        const userId = socket.user.userId;
        const userRole = socket.user.role;
        const userIdStr = userId.toString();

        console.log(`Socket CONNECTED: ${socket.id} (User ID: ${userId}, Role: ${userRole})`);

        // Armazena o socket do usuário
        userSockets.set(userIdStr, socket.id);

        socket.on('disconnect', () => {
            console.log(`Socket DISCONNECTED: ${socket.id} (User ID: ${userId})`);
            // Remove o socket do usuário se for o socket atual
            if (userSockets.get(userIdStr) === socket.id) {
                userSockets.delete(userIdStr);
            }
        });

        // Evento de teste (opcional, mas bom para depuração)
        socket.on('ping', (callback) => {
          console.log(`[Socket Event] Received ping from ${userId}`);
          if (typeof callback === 'function') {
            callback('pong'); // Envia confirmação
          }
        });
    });
}

// Função para obter o socketId de um usuário específico
function getUserSocket(userId) {
    if (userId) {
        return userSockets.get(userId.toString());
    }
    return null;
}

module.exports = { initializeSocket, getUserSocket };