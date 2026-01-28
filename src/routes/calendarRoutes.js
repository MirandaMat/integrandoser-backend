const express = require('express');
const pool = require('../config/db.js');
const { protect, isAdmin, isProfissional } = require('../middleware/authMiddleware.js');
const router = express.Router();

// --- HELPERS ---

// 1. Extrai as linhas puras do resultado do banco (compatível com MariaDB e MySQL2)
const getRows = (result) => {
    if (!result) return [];
    // Padrão MySQL2: [rows, fields] -> retorna rows
    if (Array.isArray(result) && result.length > 0 && Array.isArray(result[0])) {
        return result[0];
    }
    // Padrão MariaDB: rows -> retorna rows
    return Array.isArray(result) ? result : [];
};

// 2. Limpa os objetos RowDataPacket e converte BigInts para String
const cleanRows = (rows) => {
    if (!rows || !Array.isArray(rows)) return [];
    
    // Converte para JSON e volta para remover protótipos do driver (RowDataPacket)
    // E usa um replacer para tratar BigInts
    return JSON.parse(JSON.stringify(rows, (key, value) => 
        typeof value === 'bigint' ? value.toString() : value
    ));
};

// --- ROTAS ---

// Rota Calendário ADMIN
router.get('/admin', protect, isAdmin, async (req, res) => {
    let conn;
    console.log(`[Calendar Admin] Request recebido. User: ${req.user.userId}`);

    try {
        conn = await pool.getConnection();

        // 1. Consultas normais (Appointments)
        // Adicionado COALESCE para evitar títulos NULL
        const appointmentsQuery = `
            SELECT 
                CONCAT('app-', a.id) as id, 
                a.id as original_id,
                a.series_id, 
                COALESCE(CONCAT('Consulta: ', pat.nome, ' com ', prof.nome), 'Consulta (Dados indisponíveis)') as title,
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
        const appointments = cleanRows(getRows(appResult));
        console.log(`[Calendar Admin] Consultas processadas: ${appointments.length}`);

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
        const screenResult = await conn.query(screeningQuery);
        const screeningAppointments = cleanRows(getRows(screenResult));

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
        const slotsResult = await conn.query(slotsQuery);
        const availableSlots = cleanRows(getRows(slotsResult));

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
        const personalResult = await conn.query(personalQuery, [req.user.userId]);
        const personalAppointments = cleanRows(getRows(personalResult));

        // Envia a resposta limpa
        res.json({
            appointments,
            screeningAppointments,
            availableSlots,
            personalAppointments
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
        const appResult = await conn.query(appQuery, [professionalId]);
        const appointments = cleanRows(getRows(appResult));

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
        const personalResult = await conn.query(personalQuery, [userId]);
        const personalAppointments = cleanRows(getRows(personalResult));

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
        const slotsResult = await conn.query(slotsQuery, [professionalId]);
        const availableSlots = cleanRows(getRows(slotsResult));

        res.json({
            appointments,
            screeningAppointments: [], 
            availableSlots,
            personalAppointments
        });

    } catch (error) {
        console.error("[Calendar Professional] ERRO CRÍTICO:", error);
        res.status(500).json({ message: 'Erro ao carregar agenda.', error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

module.exports = router;