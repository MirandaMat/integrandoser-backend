// server/src/routes/authRoutes.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db.js');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// Cria um "limitador" que permite 10 tentativas de login por IP a cada 15 minutos.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 10, // Limita cada IP a 10 requisições por janela de tempo
    message: 'Muitas tentativas de login a partir deste IP. Por favor, tente novamente após 15 minutos.',
    standardHeaders: true, // Retorna informações do limite nos headers `RateLimit-*`
    legacyHeaders: false, // Desabilita os headers antigos `X-RateLimit-*`
});

router.post('/login', loginLimiter, async (req, res) => { // <--- ADICIONE O MIDDLEWARE AQUI
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email e senha são obrigatórios.' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    const query = `
      SELECT u.id, u.email, u.password, u.status, r.name as role, u.first_login
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE u.email = ?
    `;

    // CORREÇÃO CRÍTICA: Leitura de dados do banco de forma segura.
    const rows = await conn.query(query, [email]);

    if (!rows || rows.length === 0) {
      return res.status(401).json({ message: 'Credenciais inválidas.' });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: 'Credenciais inválidas.' });
    }

    if (user.status === 'blocked') {
      return res.status(403).json({ message: 'Seu acesso está bloqueado. Entre em contato com o suporte.' });
    }

    const userIdAsString = String(user.id);
    const payload = { userId: userIdAsString, role: user.role };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });

    res.json({
      message: 'Acesso bem-sucedido!',
      token,
      user: { id: userIdAsString, email: user.email, role: user.role, first_login: user.first_login }
    });

  } catch (err) {
    console.error("Erro no login:", err);
    res.status(500).json({ message: 'Erro no servidor.' });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;