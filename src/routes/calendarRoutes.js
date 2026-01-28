const express = require('express');
const pool = require('../config/db.js');
const { protect, isAdmin, isProfissional } = require('../middleware/authMiddleware.js');
const router = express.Router();

// Helper para normalizar retorno do DB (MariaDB vs MySQL2)
const getRows = (result) => {
    if (!result) return [];
    // Se for [rows, meta] (padrão mysql2), retorna rows
    if (Array.isArray(result) && result.length > 0 && Array.isArray(result[0])) {
        return result[0];
    }
    // Se for apenas o array de rows (MariaDB)
    return Array.isArray(result) ? result : [];
};

// Helper Seguro para serializar BigInt e tratar Datas automaticamente
const serializeData = (data) => {
    return JSON.parse(JSON.stringify(data, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
    ));
};

// Rota Calendário ADMIN
router.get('/admin', protect, isAdmin, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();

        // 1. Consultas normais (Appointments) - Adicionado prefixo ID e tempo final
        const appointmentsQuery = `
            SELECT 
                CONCAT('app-', a.id) as id, a.id as original_id,
                a.series_id, 
                CONCAT('Consulta: ', pat.nome, ' com ', prof.nome) as title,
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
        const appResult = await conn.query(appointmentsQuery);
        const appointments = getRows(appResult);

        // 2. Agendamentos de triagem
        const screeningQuery = `
            SELECT 
                CONCAT('triage-', ta.id) as id, ta.id as original_id,
                CONCAT('Triagem: ', ta.user_name) as title,
                aa.start_time as start,
                DATE_ADD(aa.start_time, INTERVAL 30 MINUTE) as end,
                ta.status,
                'triagem' as type
            FROM triagem_appointments ta
            JOIN admin_availability aa ON ta.availability_id = aa.id
        `;
        const screenResult = await conn.query(screeningQuery);
        const screeningAppointments = getRows(screenResult);

        // 3. Horários de triagem disponíveis
        const slotsQuery = `
            SELECT 
                CONCAT('slot-adm-', id) as id, id as original_id,
                'Horário de triagem disponível' as title,
                start_time as start,
                DATE_ADD(start_time, INTERVAL 30 MINUTE) as end,
                'Disponível' as status,
                'triagem_disponivel' as type
            FROM admin_availability 
            WHERE is_booked = FALSE AND start_time > NOW()
        `;
        const slotsResult = await conn.query(slotsQuery);
        const availableSlots = getRows(slotsResult);

        // 4. Compromissos Pessoais
        const personalQuery = `
            SELECT 
                CONCAT('personal-', id) as id, id as original_id,
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
        const personalResult = await conn.query(personalQuery, [req.user.userId]);
        const personalAppointments = getRows(personalResult);

        res.json(serializeData({
            appointments,
            screeningAppointments,
            availableSlots,
            personalAppointments
        }));

    } catch (error) {
        console.error("[Calendar Admin] Error:", error);
        res.status(500).json({ message: 'Erro ao carregar calendário.' });
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
        
        // Busca ID do Profissional
        const profResult = await conn.query("SELECT id FROM professionals WHERE user_id = ?", [userId]);
        const profRows = getRows(profResult);
        
        if (profRows.length === 0) {
            return res.status(404).json({ message: 'Perfil profissional não encontrado.' });
        }
        const professionalId = profRows[0].id;

        // 1. Consultas
        const appQuery = `
            SELECT 
                CONCAT('app-', a.id) as id, a.id as original_id,
                a.series_id,
                CONCAT('Consulta: ', p.nome) as title,
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
        const appResult = await conn.query(appQuery, [professionalId]);
        const appointments = getRows(appResult);

        // 2. Compromissos Pessoais
        const personalQuery = `
            SELECT 
                CONCAT('personal-', id) as id, id as original_id,
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
        const personalResult = await conn.query(personalQuery, [userId]);
        const personalAppointments = getRows(personalResult);

        // 3. Horários Livres (Disponibilidade)
        const slotsQuery = `
            SELECT 
                CONCAT('slot-prof-', id) as id, id as original_id,
                'Horário Livre' as title,
                start_time as start,
                end_time as end,
                'Livre' as status,
                'slot_reagendamento' as type
            FROM professional_availability
            WHERE professional_id = ? AND is_booked = FALSE
        `;
        const slotsResult = await conn.query(slotsQuery, [professionalId]);
        const availableSlots = getRows(slotsResult);

        res.json(serializeData({
            appointments,
            screeningAppointments: [], 
            availableSlots,
            personalAppointments
        }));

    } catch (error) {
        console.error("[Calendar Professional] Error:", error);
        res.status(500).json({ message: 'Erro ao carregar agenda.' });
    } finally {
        if (conn) conn.release();
    }
});

module.exports = router;