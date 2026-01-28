// server/src/routes/calendarRoutes.js
const express = require('express');
const pool = require('../config/db.js');
const { protect, isAdmin, isProfissional } = require('../middleware/authMiddleware.js');
const router = express.Router();

// Função auxiliar para garantir que pegamos as linhas corretamente 
// (compatibilidade entre mysql2 padrão e mysql2/promise)
const getRows = (result) => {
    // Se o resultado for [rows, fields] (array onde o primeiro item é outro array), retornamos o primeiro item.
    // Caso contrário, assumimos que o resultado já são as linhas.
    if (Array.isArray(result) && Array.isArray(result[0])) {
        return result[0];
    }
    return result;
};

// Função auxiliar para converter BigInt
const serializeBigInts = (data) => {
    if (data === null || data === undefined) return []; // Retorna array vazio se nulo para evitar erros no frontend
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

// Rota Calendário ADMIN
router.get('/admin', protect, isAdmin, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();

        // 1. Consultas normais 
        const appointmentsQuery = `
            SELECT 
                a.id, a.id as original_id,
                a.series_id, 
                CONCAT('Consulta: ', pat.nome, ' com ', prof.nome) as title,
                a.appointment_time as start,
                a.appointment_time, 
                a.status,
                a.session_value,    
                a.patient_id,       
                a.professional_id,  
                'consulta' as type,
                prof.nome as professional_name,
                pat.nome as patient_name,
                pat.imagem_url as patient_photo
            FROM appointments a
            JOIN professionals prof ON a.professional_id = prof.id
            JOIN patients pat ON a.patient_id = pat.id
        `;
        const appointmentsResult = await conn.query(appointmentsQuery);
        const appointments = getRows(appointmentsResult);

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
        const screeningResult = await conn.query(screeningAppointmentsQuery);
        const screeningAppointments = getRows(screeningResult);

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
        const slotsResult = await conn.query(availableSlotsQuery);
        const availableSlots = getRows(slotsResult);

        // 4. Compromissos Pessoais
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
        const personalResult = await conn.query(personalAppsQuery, [req.user.userId]);
        const personalAppointments = getRows(personalResult);

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

// Rota Calendário PROFISSIONAL
router.get('/professional', protect, isProfissional, async (req, res) => {
    const { userId } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();
        
        const profResult = await conn.query("SELECT id FROM professionals WHERE user_id = ?", [userId]);
        const profRows = getRows(profResult);
        
        if (!profRows || profRows.length === 0) {
            return res.status(404).json({ message: 'Perfil profissional não encontrado.' });
        }
        const professionalId = profRows[0].id;

        // 2. Consultas 
        const queryAppointments = `
            SELECT 
                a.id, a.id as original_id,
                a.series_id,
                CONCAT('Consulta: ', p.nome) as title,
                a.appointment_time as start,
                a.appointment_time, 
                a.status,
                a.session_value,    
                a.patient_id,       
                a.professional_id,  
                'consulta' as type,
                p.nome as patient_name,
                p.imagem_url as patient_photo
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            WHERE a.professional_id = ?
        `;
        const appointmentsResult = await conn.query(queryAppointments, [professionalId]);
        const appointments = getRows(appointmentsResult);

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
        const personalResult = await conn.query(queryPersonal, [userId]);
        const personalAppointments = getRows(personalResult);

        // 4. Horários Livres (Disponibilidade para Reagendamento)
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
        const slotsResult = await conn.query(querySlots, [professionalId]);
        const availableSlots = getRows(slotsResult);

        res.json({
            appointments: serializeBigInts(appointments),
            screeningAppointments: [],
            availableSlots: serializeBigInts(availableSlots),
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