const express = require('express');
const pool = require('../config/db.js');
const { protect, isAdmin, isProfissional } = require('../middleware/authMiddleware.js');
const router = express.Router();

/**
 * Função de serialização robusta. 
 * Trata BigInt e garante que o retorno seja sempre um Array plano de objetos.
 */
const serializeData = (data) => {
    if (!data) return [];
    // Se o driver retornar [rows, fields], pegamos apenas rows
    const rows = Array.isArray(data) && Array.isArray(data[0]) === false ? data : (data[0] || []);
    
    return rows.map(item => {
        const newItem = {};
        for (const key in item) {
            newItem[key] = typeof item[key] === 'bigint' ? item[key].toString() : item[key];
        }
        return newItem;
    });
};

// Rota unificada para Admin
router.get('/admin', protect, isAdmin, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();

        // 1. Consultas (Appointments)
        const appointments = await conn.query(`
            SELECT a.id, a.id as original_id, a.series_id, a.status, a.session_value, a.patient_id, a.professional_id,
                   CONCAT('Consulta: ', pat.nome, ' c/ ', prof.nome) as title,
                   a.appointment_time as start, 'consulta' as type,
                   prof.nome as professional_name, pat.nome as patient_name
            FROM appointments a
            JOIN professionals prof ON a.professional_id = prof.id
            JOIN patients pat ON a.patient_id = pat.id
        `);

        // 2. Triagem (Screening)
        const screening = await conn.query(`
            SELECT CONCAT('triage-', ta.id) as id, ta.id as original_id, ta.status,
                   CONCAT('Triagem: ', ta.user_name) as title, aa.start_time as start, 'triagem' as type
            FROM triagem_appointments ta
            JOIN admin_availability aa ON ta.availability_id = aa.id
        `);

        // 3. Slots de Triagem Livres
        const slots = await conn.query(`
            SELECT CONCAT('slot-', id) as id, id as original_id, 'Horário Disponível' as title,
                   start_time as start, 'Disponível' as status, 'triagem_disponivel' as type
            FROM admin_availability WHERE is_booked = FALSE AND start_time > NOW()
        `);

        // 4. Compromissos Pessoais
        const personal = await conn.query(`
            SELECT id, id as original_id, title, start_time as start, end_time as end, 
                   status, color, description, 'pessoal' as type
            FROM personal_appointments WHERE user_id = ?
        `, [req.user.userId]);

        res.json({
            appointments: serializeData(appointments),
            screeningAppointments: serializeData(screening),
            availableSlots: serializeData(slots),
            personalAppointments: serializeData(personal)
        });
    } catch (error) {
        console.error("[Calendar Admin Error]:", error);
        res.status(500).json({ message: 'Erro ao carrergar dados.' });
    } finally {
        if (conn) conn.release();
    }
});

// Rota unificada para Profissional
router.get('/professional', protect, isProfissional, async (req, res) => {
    const { userId } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();
        const [prof] = await conn.query("SELECT id FROM professionals WHERE user_id = ?", [userId]);
        if (!prof) return res.status(404).json({ message: 'Perfil não encontrado.' });

        const appointments = await conn.query(`
            SELECT a.id, a.id as original_id, a.series_id, a.status, a.appointment_time as start,
                   CONCAT('Consulta: ', p.nome) as title, 'consulta' as type, p.nome as patient_name
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            WHERE a.professional_id = ?
        `, [prof.id]);

        const personal = await conn.query(`
            SELECT id, id as original_id, title, start_time as start, end_time as end, 
                   status, color, description, 'pessoal' as type
            FROM personal_appointments WHERE user_id = ?
        `, [userId]);

        const slots = await conn.query(`
            SELECT CONCAT('pslot-', id) as id, id as original_id, 'Horário Livre' as title,
                   start_time as start, end_time as end, 'Livre' as status, 'slot_reagendamento' as type
            FROM professional_availability WHERE professional_id = ? AND is_booked = FALSE
        `, [prof.id]);

        res.json({
            appointments: serializeData(appointments),
            screeningAppointments: [],
            availableSlots: serializeData(slots),
            personalAppointments: serializeData(personal)
        });
    } catch (error) {
        console.error("[Calendar Professional Error]:", error);
        res.status(500).json({ message: 'Erro ao carregar agenda.' });
    } finally {
        if (conn) conn.release();
    }
});

module.exports = router;