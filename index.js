// server/index.js
const dotenv = require('dotenv');
dotenv.config(); 

const express = require('express');
const cors = require('cors');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io'); 
const { initializeSocket, getUserSocket } = require('./src/socketHandlers.js'); 
const initScheduledJobs = require('./src/services/cronJobs.js');

// --- Reativar TODAS as rotas ---
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
// --- Fim da reativação ---

const app = express();
app.set('trust proxy', 1);
const port = process.env.PORT || 3001;

// Configuração do CORS
const allowedOrigins = [
    'http://localhost:5173', 
    'https://integrandoser.com.br', 
    'https://www.integrandoser.com.br',
    'https://integrandoser.integrandoser.com.br', 
    process.env.FRONTEND_URL 
];

const corsOptions = {
    origin: function (origin, callback) {
        // Permitir requisições sem 'origin' (ex: Postman) ou de origens permitidas
        if (!origin || allowedOrigins.indexOf(origin) !== -1) { // A lógica aqui já funciona com a lista atualizada
            callback(null, true);
        } else {
            console.warn(`CORS: Origem REJEITADA: ${origin}`); // Log de depuração
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
};
app.use(cors(corsOptions));

app.use(express.json());

// Criar o servidor HTTP
const httpServer = createServer(app);


const io = new Server(httpServer, {
    cors: {
        origin: allowedOrigins, // Usa a mesma lista de origens
        methods: ["GET", "POST"],
        credentials: true
    }
});
app.set('io', io); // Disponibiliza o 'io' para as rotas
app.set('getUserSocket', getUserSocket); // Disponibiliza a função para as rotas
initializeSocket(io); // Inicializa os handlers de conexão do socket



// Útil para verificar se o servidor está no ar
app.get('/', (req, res) => {
  console.log('[HEALTH CHECK] Rota / acessada. Servidor está operacional.');
  res.status(200).send('Servidor IntegrandoSer está operacional!');
});


// --- Reativar Rotas da API ---
// O Express usará estas rotas agora
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


app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


app.use((req, res, next) => {
    console.warn(`[404] Rota não encontrada: ${req.method} ${req.originalUrl}`);
    res.status(404).send({ message: 'Rota não encontrada' });
});


process.on('uncaughtException', (error) => {
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.error('UNCAUGHT EXCEPTION:', error);
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.error('UNHANDLED REJECTION:', reason);
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
});

httpServer.on('error', (error) => {
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.error('HTTP SERVER ERROR:', error);
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
});

httpServer.on('clientError', (err, socket) => {
    console.error(`Client Error: ${err}`);
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});


// Iniciar o servidor
httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Servidor completo rodando na porta ${port} ouvindo em 0.0.0.0`);

  // Iniciar o Cron Job após o servidor subir
  initScheduledJobs(); 
  console.log('[Cron Service] Agendador de tarefas iniciado.');
});