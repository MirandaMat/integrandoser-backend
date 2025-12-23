// server/src/routes/calendarRoutes.js
const express = require('express');
const pool = require('../config/db.js');
const { protect, isAdmin, isProfissional } = require('../middleware/authMiddleware.js');
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

        // 1. Consultas normais
        // Alterado para incluir "com [Nome do Profissional]" no título
        const appointmentsQuery = `
            SELECT 
                a.id, a.id as original_id,
                CONCAT('Consulta: ', pat.nome, ' com ', prof.nome) as title,
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

        // 2. Agendamentos de triagem
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

        // 3. Horários de triagem disponíveis
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

        // 4. Compromissos Pessoais (Adicione este bloco)
        const personalAppsQuery = `
            SELECT 
                id, id as original_id,
                title,
                start_time as start,
                end_time as end,
                status,
                color,
                description,
                'pessoal' as type
            FROM personal_appointments
            WHERE user_id = ?
        `;

        const personalAppointments = await conn.query(personalAppsQuery, [req.user.userId]);

        res.json({
            appointments: serializeBigInts(appointments),
            screeningAppointments: serializeBigInts(screeningAppointments),
            availableSlots: serializeBigInts(availableSlots),
            personalAppointments: serializeBigInts(personalAppointments)
        });

    } catch (error) {
        console.error("Erro ao buscar dados do calendário do admin:", error);
        res.status(500).json({ message: 'Erro ao carregar dados do calendário.' });
    } finally {
        if (conn) conn.release();
    }
});


router.get('/professional', protect, isProfissional, async (req, res) => {
    const { userId } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();
        
        // 1. Identifica o ID do profissional
        const [profProfile] = await conn.query("SELECT id FROM professionals WHERE user_id = ?", [userId]);
        
        if (!profProfile) {
            return res.status(404).json({ message: 'Perfil profissional não encontrado.' });
        }
        const professionalId = profProfile.id;

        // 2. Consultas (Appointments)
        const queryAppointments = `
            SELECT 
                a.id, a.id as original_id,
                CONCAT('Consulta: ', p.nome) as title,
                a.appointment_time as start,
                a.status,
                'consulta' as type,
                p.nome as patient_name
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            WHERE a.professional_id = ?
        `;
        const appointments = await conn.query(queryAppointments, [professionalId]);

        // 3. Compromissos Pessoais
        const queryPersonal = `
            SELECT 
                id, id as original_id,
                title,
                start_time as start,
                end_time as end,
                status,
                color,
                description,
                'pessoal' as type
            FROM personal_appointments
            WHERE user_id = ?
        `;
        const personalAppointments = await conn.query(queryPersonal, [userId]);

        // 4. NOVO: Horários Livres (Disponibilidade para Reagendamento)
        const querySlots = `
            SELECT 
                CONCAT('slot-', id) as id, id as original_id,
                'Horário Livre' as title,
                start_time as start,
                end_time as end,
                'Livre' as status,
                'slot_reagendamento' as type
            FROM professional_availability
            WHERE professional_id = ? AND is_booked = FALSE
        `;
        const availableSlots = await conn.query(querySlots, [professionalId]);

        res.json({
            appointments: serializeBigInts(appointments),
            screeningAppointments: [],
            availableSlots: serializeBigInts(availableSlots), // Enviando os slots
            personalAppointments: serializeBigInts(personalAppointments)
        });
    } catch (error) {
        console.error("Erro ao buscar dados do calendário do profissional:", error);
        res.status(500).json({ message: 'Erro ao carregar agenda.' });
    } finally {
        if (conn) conn.release();
    }
});

module.exports = router;