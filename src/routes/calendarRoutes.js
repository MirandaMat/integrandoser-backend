const express = require('express');
const pool = require('../config/db.js');
const { protect, isAdmin, isProfissional } = require('../middleware/authMiddleware.js');
const router = express.Router();

// Função auxiliar robusta para converter BigInt e lidar com retornos do pool [rows, fields]
const serializeData = (data) => {
    if (!data) return [];
    // Garante que estamos pegando as linhas, mesmo se o driver retornar metadados
    const rows = (Array.isArray(data) && Array.isArray(data[0])) ? data[0] : data;
    
    return rows.map(item => {
        const newItem = {};
        for (const key in item) {
            newItem[key] = typeof item[key] === 'bigint' ? item[key].toString() : item[key];
        }
        return newItem;
    });
};

router.get('/admin', protect, isAdmin, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();

        // 1. Consultas Normais
        const appointments = await conn.query(`
            SELECT a.id, a.id as original_id, a.series_id, a.status, a.session_value,
                   CONCAT('Consulta: ', pat.nome, ' c/ ', prof.nome) as title,
                   a.appointment_time as start, 'consulta' as type
            FROM appointments a
            JOIN professionals prof ON a.professional_id = prof.id
            JOIN patients pat ON a.patient_id = pat.id
        `);

        // 2. Slots de Triagem Disponíveis (admin_availability)
        const availableSlots = await conn.query(`
            SELECT CONCAT('slot-', id) as id, id as original_id,
                   'Horário de triagem disponível' as title,
                   start_time as start, 'triagem_disponivel' as type
            FROM admin_availability 
            WHERE is_booked = FALSE AND start_time > NOW()
        `);

        // 3. Compromissos Pessoais (personal_appointments)
        const personal = await conn.query(`
            SELECT id, id as original_id, title, start_time as start, end_time as end,
                   status, color, description, 'pessoal' as type
            FROM personal_appointments WHERE user_id = ?
        `, [req.user.userId]);

        res.json({
            appointments: serializeData(appointments),
            screeningAppointments: [],
            availableSlots: serializeData(availableSlots),
            personalAppointments: serializeData(personal)
        });
    } catch (error) {
        console.error("Erro Calendar Admin:", error);
        res.status(500).json({ message: 'Erro ao carregar calendário.' });
    } finally {
        if (conn) conn.release();
    }
});

router.get('/professional', protect, isProfissional, async (req, res) => {
    const { userId } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();
        const [prof] = await conn.query("SELECT id FROM professionals WHERE user_id = ?", [userId]);
        if (!prof) return res.status(404).json({ message: 'Perfil não encontrado.' });

        const appointments = await conn.query(`
            SELECT a.id, a.id as original_id, a.series_id, a.status,
                   CONCAT('Consulta: ', p.nome) as title, a.appointment_time as start, 'consulta' as type
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            WHERE a.professional_id = ?
        `, [prof.id]);

        const personal = await conn.query(`
            SELECT id, id as original_id, title, start_time as start, end_time as end,
                   status, color, description, 'pessoal' as type
            FROM personal_appointments WHERE user_id = ?
        `, [userId]);

        res.json({
            appointments: serializeData(appointments),
            availableSlots: [],
            personalAppointments: serializeData(personal)
        });
    } catch (error) {
        console.error("Erro Calendar Profissional:", error);
        res.status(500).json({ message: 'Erro ao carregar agenda.' });
    } finally {
        if (conn) conn.release();
    }
});

module.exports = router;