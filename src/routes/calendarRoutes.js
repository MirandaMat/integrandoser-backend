// server/src/routes/calendarRoutes.js
const express = require('express');
const pool = require('../config/db.js');
const { protect, isAdmin, isProfissional } = require('../middleware/authMiddleware.js');
const router = express.Router();

// Função auxiliar para normalizar o retorno do banco de dados (MySQL2/MariaDB)
const getRows = (result) => {
    if (!result) return [];
    // Se for um array de arrays (padrão [rows, fields]), retorna o primeiro (rows)
    // Caso contrário, retorna o próprio resultado
    return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
};

// Função auxiliar para converter BigInt
const serializeBigInts = (data) => {
    if (data === null || data === undefined) return [];
    
    // Garante que seja um array para o map funcionar
    const isArray = Array.isArray(data);
    const dataToProcess = isArray ? data : [data];

    return dataToProcess.map(item => {
        const newItem = {};
        for (const key in item) {
            // Converte BigInt para string para não quebrar o JSON
            newItem[key] = typeof item[key] === 'bigint' ? item[key].toString() : item[key];
        }
        return newItem;
    });
};

// Rota Calendário ADMIN
router.get('/admin', protect, isAdmin, async (req, res) => {
    let conn;
    console.log(`[Calendar Admin] Iniciando busca para usuário ID: ${req.user.userId}`);

    try {
        conn = await pool.getConnection();

        // 1. Consultas normais (Appointments)
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
        console.log(`[Calendar Admin] Consultas encontradas: ${appointments?.length || 0}`);

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
        console.log(`[Calendar Admin] Triagens encontradas: ${screeningAppointments?.length || 0}`);

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
        console.log(`[Calendar Admin] Slots disponíveis: ${availableSlots?.length || 0}`);

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
        console.log(`[Calendar Admin] Pessoais encontrados: ${personalAppointments?.length || 0}`);

        const responseData = {
            appointments: serializeBigInts(appointments),
            screeningAppointments: serializeBigInts(screeningAppointments),
            availableSlots: serializeBigInts(availableSlots),
            personalAppointments: serializeBigInts(personalAppointments)
        };

        res.json(responseData);

    } catch (error) {
        console.error("[Calendar Admin] ERRO CRÍTICO:", error);
        res.status(500).json({ message: 'Erro ao carregar dados do calendário.', details: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// Rota Calendário PROFISSIONAL
router.get('/professional', protect, isProfissional, async (req, res) => {
    const { userId } = req.user;
    let conn;
    console.log(`[Calendar Professional] Iniciando busca para UserID: ${userId}`);

    try {
        conn = await pool.getConnection();
        
        // 1. Busca ID do Profissional
        const profResult = await conn.query("SELECT id FROM professionals WHERE user_id = ?", [userId]);
        const profRows = getRows(profResult);
        
        if (!profRows || profRows.length === 0) {
            console.warn(`[Calendar Professional] Perfil profissional não encontrado para UserID: ${userId}`);
            return res.status(404).json({ message: 'Perfil profissional não encontrado.' });
        }
        
        const professionalId = profRows[0].id;
        console.log(`[Calendar Professional] ProfessionalID identificado: ${professionalId}`);

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
        console.log(`[Calendar Professional] Consultas: ${appointments?.length || 0}`);

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
        console.log(`[Calendar Professional] Pessoais: ${personalAppointments?.length || 0}`);

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
        console.log(`[Calendar Professional] Slots livres: ${availableSlots?.length || 0}`);

        const responseData = {
            appointments: serializeBigInts(appointments),
            screeningAppointments: [], 
            availableSlots: serializeBigInts(availableSlots),
            personalAppointments: serializeBigInts(personalAppointments)
        };

        res.json(responseData);

    } catch (error) {
        console.error("[Calendar Professional] ERRO CRÍTICO:", error);
        res.status(500).json({ message: 'Erro ao carregar agenda.', details: error.message });
    } finally {
        if (conn) conn.release();
    }
});

module.exports = router;