// server/src/routes/calendarRoutes.js
const express = require('express');
const pool = require('../config/db.js');
const { protect, isAdmin, isProfissional } = require('../middleware/authMiddleware.js'); // Corrigido para isProfissional
const router = express.Router();

// Função auxiliar (sem alterações)
const serializeBigInts = (data) => {
    if (data === null || data === undefined) return data;
    const isArray = Array.isArray(data);
    const dataToProcess = isArray ? data : [data];
    return dataToProcess.map(item => {
        const newItem = {};
        for (const key in item) {
            newItem[key] = typeof item[key] === 'bigint' ? item[key].toString() : item[key];
        }
        return newItem;
    });
};

/**
 * ROTA PARA O CALENDÁRIO DO ADMIN (ATUALIZADA)
 * Agrega consultas, agendamentos de triagem e horários de triagem disponíveis.
 */
router.get('/admin', protect, isAdmin, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();

        // 1. Consultas normais (adicionado 'a.id as original_id')
        const appointmentsQuery = `
            SELECT 
                a.id, a.id as original_id,
                CONCAT('Consulta: ', pat.nome) as title,
                a.appointment_time as start,
                a.status,
                'consulta' as type,
                prof.nome as professional_name,
                pat.nome as patient_name
            FROM appointments a
            JOIN professionals prof ON a.professional_id = prof.id
            JOIN patients pat ON a.patient_id = pat.id
        `;
        const appointments = await conn.query(appointmentsQuery);

        // 2. Agendamentos de triagem (adicionado 'ta.id as original_id')
        const screeningAppointmentsQuery = `
            SELECT 
                CONCAT('triage-', ta.id) as id, ta.id as original_id,
                CONCAT('Triagem: ', ta.user_name) as title,
                aa.start_time as start,
                ta.status,
                'triagem' as type
            FROM triagem_appointments ta
            JOIN admin_availability aa ON ta.availability_id = aa.id
        `;
        const screeningAppointments = await conn.query(screeningAppointmentsQuery);

        // 3. Horários de triagem disponíveis (adicionado 'id as original_id')
        const availableSlotsQuery = `
            SELECT 
                CONCAT('slot-', id) as id, id as original_id,
                'Horário de triagem disponível' as title,
                start_time as start,
                'Disponível' as status,
                'triagem_disponivel' as type
            FROM admin_availability 
            WHERE is_booked = FALSE AND start_time > NOW()
        `;
        const availableSlots = await conn.query(availableSlotsQuery);

        res.json({
            appointments: serializeBigInts(appointments),
            screeningAppointments: serializeBigInts(screeningAppointments),
            availableSlots: serializeBigInts(availableSlots)
        });

    } catch (error) {
        console.error("Erro ao buscar dados do calendário do admin:", error);
        res.status(500).json({ message: 'Erro ao carregar dados do calendário.' });
    } finally {
        if (conn) conn.release();
    }
});


/**
 * ROTA PARA O CALENDÁRIO DO PROFISSIONAL (ATUALIZADA)
 * Busca apenas as consultas vinculadas ao profissional logado.
 */
router.get('/professional', protect, isProfissional, async (req, res) => {
    const { userId } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();
        // Adicionado 'a.id as original_id'
        const query = `
            SELECT 
                a.id, a.id as original_id,
                CONCAT('Consulta: ', p.nome) as title,
                a.appointment_time as start,
                a.status,
                'consulta' as type,
                p.nome as patient_name
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            JOIN professionals prof ON a.professional_id = prof.id
            WHERE prof.user_id = ?
        `;
        const appointments = await conn.query(query, [userId]);
        res.json({
            appointments: serializeBigInts(appointments),
            screeningAppointments: [],
            availableSlots: []
        });
    } catch (error) {
        console.error("Erro ao buscar dados do calendário do profissional:", error);
        res.status(500).json({ message: 'Erro ao carregar agenda.' });
    } finally {
        if (conn) conn.release();
    }
});

module.exports = router;