// server/src/routes/calendarRoutes.js
const express = require('express');
const pool = require('../config/db.js');
const { protect, isAdmin, isProfissional } = require('../middleware/authMiddleware.js');
const router = express.Router();

// Função auxiliar idêntica ao agendaRoutes.js para consistência
const serializeBigInts = (data) => {
    if (data === null || data === undefined) return data;
    if (!Array.isArray(data)) {
        const singleItem = {};
        for (const key in data) {
            if (typeof data[key] === 'bigint') singleItem[key] = data[key].toString();
            else singleItem[key] = data[key];
        }
        return singleItem;
    }
    return data.map(item => {
        const newItem = {};
        for (const key in item) {
            if (typeof item[key] === 'bigint') newItem[key] = item[key].toString();
            else newItem[key] = item[key];
        }
        return newItem;
    });
};

// Rota Calendário ADMIN
router.get('/admin', protect, isAdmin, async (req, res) => {
    let conn;
    console.log(`[Calendar Admin] Request recebido. User: ${req.user.userId}`);

    try {
        conn = await pool.getConnection();

        // 1. Consultas normais (Appointments)
        const appointmentsQuery = `
            SELECT 
                CONCAT('app-', a.id) as id, 
                a.id as original_id,
                a.series_id, 
                COALESCE(CONCAT('Consulta: ', pat.nome, ' com ', prof.nome), 'Consulta') as title,
                a.appointment_time as start,
                DATE_ADD(a.appointment_time, INTERVAL 50 MINUTE) as end,
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
        const appointments = await conn.query(appointmentsQuery);

        // 2. Agendamentos de triagem
        const screeningQuery = `
            SELECT 
                CONCAT('triage-', ta.id) as id, 
                ta.id as original_id,
                COALESCE(CONCAT('Triagem: ', ta.user_name), 'Triagem') as title,
                aa.start_time as start,
                DATE_ADD(aa.start_time, INTERVAL 30 MINUTE) as end,
                ta.status,
                'triagem' as type
            FROM triagem_appointments ta
            JOIN admin_availability aa ON ta.availability_id = aa.id
        `;
        const screeningAppointments = await conn.query(screeningQuery);

        // 3. Horários de triagem disponíveis
        const slotsQuery = `
            SELECT 
                CONCAT('slot-adm-', id) as id, 
                id as original_id,
                'Horário de triagem disponível' as title,
                start_time as start,
                DATE_ADD(start_time, INTERVAL 30 MINUTE) as end,
                'Disponível' as status,
                'triagem_disponivel' as type
            FROM admin_availability 
            WHERE is_booked = 0 AND start_time > NOW()
        `;
        const availableSlots = await conn.query(slotsQuery);

        // 4. Compromissos Pessoais
        const personalQuery = `
            SELECT 
                CONCAT('personal-', id) as id, 
                id as original_id,
                COALESCE(title, 'Compromisso Pessoal') as title,
                start_time as start,
                COALESCE(end_time, DATE_ADD(start_time, INTERVAL 1 HOUR)) as end,
                status,
                color,
                description,
                'pessoal' as type
            FROM personal_appointments
            WHERE user_id = ?
        `;
        const personalAppointments = await conn.query(personalQuery, [req.user.userId]);

        res.json({
            appointments: serializeBigInts(appointments),
            screeningAppointments: serializeBigInts(screeningAppointments),
            availableSlots: serializeBigInts(availableSlots),
            personalAppointments: serializeBigInts(personalAppointments)
        });

    } catch (error) {
        console.error("[Calendar Admin] ERRO CRÍTICO:", error);
        res.status(500).json({ message: 'Erro ao carregar calendário.', error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// Rota Calendário PROFISSIONAL
router.get('/professional', protect, isProfissional, async (req, res) => {
    const { userId } = req.user;
    let conn;
    console.log(`[Calendar Professional] Request recebido. User: ${userId}`);

    try {
        conn = await pool.getConnection();
        
        // CORREÇÃO CRÍTICA: Mesma lógica de 'agendaRoutes.js'. 
        // Assume que conn.query retorna rows. A desestruturação [prof] pega a primeira linha.
        const [prof] = await conn.query("SELECT id FROM professionals WHERE user_id = ?", [userId]);
        
        if (!prof) {
            console.warn(`[Calendar Professional] Perfil não encontrado para UserID: ${userId}`);
            return res.status(404).json({ message: 'Perfil profissional não encontrado.' });
        }
        const professionalId = prof.id;

        // 1. Consultas
        const appQuery = `
            SELECT 
                CONCAT('app-', a.id) as id, 
                a.id as original_id,
                a.series_id,
                COALESCE(CONCAT('Consulta: ', p.nome), 'Consulta') as title,
                a.appointment_time as start,
                DATE_ADD(a.appointment_time, INTERVAL 50 MINUTE) as end,
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
        const appointments = await conn.query(appQuery, [professionalId]);

        // 2. Compromissos Pessoais
        const personalQuery = `
            SELECT 
                CONCAT('personal-', id) as id, 
                id as original_id,
                COALESCE(title, 'Compromisso') as title,
                start_time as start,
                COALESCE(end_time, DATE_ADD(start_time, INTERVAL 1 HOUR)) as end,
                status,
                color,
                description,
                'pessoal' as type
            FROM personal_appointments
            WHERE user_id = ?
        `;
        const personalAppointments = await conn.query(personalQuery, [userId]);

        // 3. Horários Livres (Disponibilidade)
        const slotsQuery = `
            SELECT 
                CONCAT('slot-prof-', id) as id, 
                id as original_id,
                'Horário Livre' as title,
                start_time as start,
                end_time as end,
                'Livre' as status,
                'slot_reagendamento' as type
            FROM professional_availability
            WHERE professional_id = ? AND is_booked = 0
        `;
        const availableSlots = await conn.query(slotsQuery, [professionalId]);

        res.json({
            appointments: serializeBigInts(appointments),
            screeningAppointments: [], 
            availableSlots: serializeBigInts(availableSlots),
            personalAppointments: serializeBigInts(personalAppointments)
        });

    } catch (error) {
        console.error("[Calendar Professional] ERRO CRÍTICO:", error);
        res.status(500).json({ message: 'Erro ao carregar agenda.', error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

module.exports = router;