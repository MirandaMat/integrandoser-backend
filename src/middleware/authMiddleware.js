// server/src/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const pool = require('../config/db.js');

const protect = async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            
            // Esta busca no banco de dados é mais segura, pois verifica o usuário a cada requisição
            const conn = await pool.getConnection();
            const [user] = await conn.query(
                `SELECT u.id, u.email, r.name as role 
                 FROM users u 
                 JOIN roles r ON u.role_id = r.id 
                 WHERE u.id = ?`, 
                [decoded.userId]
            );
            conn.release();

            if (!user) {
                return res.status(401).json({ message: 'Não autorizado, usuário não encontrado.' });
            }

            // Anexa um objeto de usuário mais completo à requisição
            req.user = {
                userId: user.id,
                email: user.email,
                role: user.role
            };
            next();
        } catch (error) {
            console.error('Erro na verificação do token:', error.message);
            return res.status(401).json({ message: 'Token inválido ou expirado.' });
        }
    }
    if (!token) {
        return res.status(401).json({ message: 'Não autorizado, sem token.' });
    }
};

const isAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'ADM') {
        next();
    } else {
        return res.status(403).json({ message: 'Acesso negado. Requer privilégios de administrador.' });
    }
};

const isProfissional = (req, res, next) => {
    if (req.user && req.user.role === 'PROFISSIONAL') {
        next();
    } else {
        return res.status(403).json({ message: 'Acesso negado. Requer privilégios de profissional.' });
    }
};

// ===== NOVA FUNÇÃO NECESSÁRIA PARA O DIÁRIO DE SONHOS =====
const isPaciente = (req, res, next) => {
    if (req.user && req.user.role === 'PACIENTE') {
        next();
    } else {
        return res.status(403).json({ message: 'Acesso negado. Rota apenas para pacientes.' });
    }
};

// ===== FUNÇÃO REINCLUÍDA DO SEU ARQUIVO ORIGINAL =====
const isEmpresa = (req, res, next) => {
    if (req.user && req.user.role === 'EMPRESA') {
        next();
    } else {
        return res.status(403).json({ message: 'Acesso negado. Requer privilégios de empresa.' });
    }
};

module.exports = { 
    protect, 
    isAdmin, 
    isProfissional,
    isPaciente, // Exportando a nova função
    isEmpresa   // Exportando a função que já existia
};