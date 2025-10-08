// server/index.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { initializeSocket, getUserSocket } = require('./src/socketHandlers.js');

// Importação de Todas as Rotas
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

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// Configuração de CORS para Produção
const allowedOrigins = [
    'http://localhost:5173', // Para desenvolvimento local
    'https://integrandoser.com.br' // DOMÍNIO REAL CORRIGIDO
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

// Configuração do Servidor HTTP e Socket.IO
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: allowedOrigins, // Usa a mesma lista de permissões
        methods: ["GET", "POST"]
    }
});

app.set('io', io);
app.set('getUserSocket', getUserSocket);

initializeSocket(io);

// Definição de Rotas da API
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

// Servir arquivos estáticos da pasta 'uploads'
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Inicialização do Servidor
httpServer.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
