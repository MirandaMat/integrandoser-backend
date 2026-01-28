// server/src/routes/calendarRoutes.js
const express = require('express');
const pool = require('../config/db.js');
const { protect, isAdmin, isProfissional } = require('../middleware/authMiddleware.js');
const router = express.Router();

const serializeData = (data) => {
    if (!data) return [];
    let rows = [];
    if (Array.isArray(data)) {
        if (Array.isArray(data[0])) rows = data[0];
        else rows = data;
    } else if (data.rows) {
        rows = data.rows;
    }
    return rows.map(item => {
        const newItem = {};
        for (const key in item) {
            if (typeof item[key] === 'bigint') newItem[key] = item[key].toString();
            else newItem[key] = item[key];
        }
        return newItem;
    });
};

router.get('/admin', protect, isAdmin, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();

        // ALTERAÇÃO: Adicionado COALESCE para buscar valor do paciente se o do agendamento for 0/NULL
        const appointments = await conn.query(`
            SELECT a.id, a.id as original_id, a.series_id, a.status, 
                COALESCE(NULLIF(a.session_value, 0), pat.session_price, 0) as session_value,
                a.patient_id, a.professional_id, pat.company_id,
                s.frequency, 
                CONCAT('Consulta: ', pat.nome, ' com ', prof.nome) as title,
                a.appointment_time as start, 'consulta' as type
            FROM appointments a
            JOIN professionals prof ON a.professional_id = prof.id
            JOIN patients pat ON a.patient_id = pat.id
            LEFT JOIN appointment_series s ON a.series_id = s.id 
        `);

        const slots = await conn.query(`
            SELECT CONCAT('slot-', id) as id, id as original_id, 'Horário de triagem disponível' as title,
                   start_time as start, 'Disponível' as status, 'triagem_disponivel' as type
            FROM admin_availability WHERE is_booked = FALSE AND start_time > NOW()
        `);

        const personal = await conn.query(`
            SELECT id, id as original_id, title, start_time as start, end_time as end,
                   status, color, description, 'pessoal' as type
            FROM personal_appointments WHERE user_id = ?
        `, [req.user.userId]);

        res.json({
            appointments: serializeData(appointments),
            screeningAppointments: [],
            availableSlots: serializeData(slots),
            personalAppointments: serializeData(personal)
        });
    } catch (error) {
        console.error("Erro Calendar Admin:", error);
        res.status(500).json({ message: 'Erro ao buscar dados.' });
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

        // ALTERAÇÃO: Adicionado COALESCE para buscar valor do paciente se o do agendamento for 0/NULL
        const appointments = await conn.query(`
            SELECT a.id, a.id as original_id, a.series_id, a.status, 
                COALESCE(NULLIF(a.session_value, 0), p.session_price, 0) as session_value,
                a.patient_id, a.professional_id,
                s.frequency, 
                CONCAT('Consulta: ', p.nome) as title, a.appointment_time as start, 'consulta' as type
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            LEFT JOIN appointment_series s ON a.series_id = s.id 
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