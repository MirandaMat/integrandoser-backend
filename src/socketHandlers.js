// server/src/socketHandlers.js
const jwt = require('jsonwebtoken');

// Mapa para armazenar o socketId de cada usuário conectado
const userSockets = new Map();

function initializeSocket(io) {
    // Middleware de autenticação CORRIGIDO
    io.use((socket, next) => {
        // Agora lê o token do payload de autenticação, que é o padrão moderno
        let token = socket.handshake.auth.token;

        // Verifica se o token existe
        if (!token) {
            console.error('[Socket Auth] Tentativa de conexão sem token no payload.');
            return next(new Error('Authentication error: Token not provided'));
        }

        // Remove o prefixo "Bearer " se ele existir
        if (token.startsWith('Bearer ')) {
            token = token.split(' ')[1];
        }

        // Verifica o token JWT
        jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
            if (err) {
                console.error('[Socket Auth] Falha na autenticação do token:', err.message);
                return next(new Error('Authentication error: Invalid token'));
            }
            // Anexa os dados do usuário ao objeto do socket
            socket.user = decoded;
            next(); // Permite a conexão
        });
    });

    // O restante da lógica de 'connection' permanece o mesmo
    io.on('connection', (socket) => {
        const userId = socket.user.userId;
        console.log(`Usuário AUTENTICADO conectado: ${socket.id} (User ID: ${userId})`);

        userSockets.set(userId.toString(), socket.id);

        socket.on('disconnect', () => {
            console.log(`Usuário desconectado: ${socket.id} (User ID: ${userId})`);
            if (userSockets.get(userId.toString()) === socket.id) {
                userSockets.delete(userId.toString());
            }
        });
    });
}

// A função de busca permanece a mesma, mas agora será mais confiável
function getUserSocket(userId) {
    return userSockets.get(userId.toString());
}

module.exports = { initializeSocket, getUserSocket };