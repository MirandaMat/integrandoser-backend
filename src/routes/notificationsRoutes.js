// server/src/routes/notificationsRoutes.js
const express = require('express');
const pool = require('../config/db.js');
const { protect } = require('../middleware/authMiddleware.js');
const router = express.Router();

// Função auxiliar para serialização (pode ser movida para um utils se preferir)
const serializeBigInts = (data) => {
    if (typeof data === 'bigint') return data.toString();
    if (data instanceof Date) return data;
    if (data === null || typeof data !== 'object') return data;
    if (Array.isArray(data)) return data.map(item => serializeBigInts(item));
    const newObj = {};
    for (const key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
            newObj[key] = serializeBigInts(data[key]);
        }
    }
    return newObj;
};

// GET /api/notifications - Busca as notificações do usuário logado
router.get('/', protect, async (req, res) => {
    const { userId } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();
        const notifications = await conn.query(
            "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20",
            [userId]
        );
        res.json(serializeBigInts(notifications));
    } catch (error) {
        console.error("Erro ao buscar notificações:", error);
        res.status(500).json({ message: 'Erro ao buscar notificações.' });
    } finally {
        if (conn) conn.release();
    }
});

// PATCH /api/notifications/mark-all-as-read - Marca todas como lidas
router.patch('/mark-all-as-read', protect, async (req, res) => {
    const { userId } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query(
            "UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE",
            [userId]
        );
        res.json({ message: "Notificações marcadas como lidas." });
    } catch (error) {
        console.error("Erro ao marcar notificações como lidas:", error);
        res.status(500).json({ message: 'Erro ao atualizar notificações.' });
    } finally {
        if (conn) conn.release();
    }
});

// PATCH /api/notifications/:id/read - Marca uma notificação como lida
router.patch('/:id/read', protect, async (req, res) => {
    const { userId } = req.user;
    const { id } = req.params;
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query(
            "UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?",
            [id, userId]
        );
        res.json({ message: `Notificação ${id} marcada como lida.` });
    } catch (error) {
        console.error(`Erro ao marcar notificação ${id} como lida:`, error);
        res.status(500).json({ message: 'Erro ao atualizar notificação.' });
    } finally {
        if (conn) conn.release();
    }
});

// A EXPORTAÇÃO CORRETA E SIMPLES
module.exports = router;