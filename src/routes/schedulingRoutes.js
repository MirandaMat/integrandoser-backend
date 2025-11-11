// server/src/routes/schedulingRoutes.js
const express = require('express');
const pool = require('../config/db.js');
const { protect, isAdmin } = require('../middleware/authMiddleware.js');
const { sendSchedulingEmail, sendConfirmationEmail, sendUpdateEmail } = require('../config/mailer.js');
const { createNotification } = require('../services/notificationService.js');
const router = express.Router();

// Função auxiliar (essencial para consistência)
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

// --- ROTAS DO ADMIN ---

// Rota para o ADMIN DEFINIR sua disponibilidade
router.post('/availability', protect, isAdmin, async (req, res) => {
    const { slots } = req.body;
    if (!slots || !Array.isArray(slots) || slots.length === 0) {
        return res.status(400).json({ message: 'A lista de horários é obrigatória.' });
    }
    
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();
        for (const slot of slots) {
            if (!slot.start_time || !slot.end_time) throw new Error('Cada slot deve ter start_time e end_time.');
            await conn.query('INSERT INTO admin_availability (start_time, end_time) VALUES (?, ?)', [new Date(slot.start_time), new Date(slot.end_time)]);
        }
        await conn.commit();
        res.status(201).json({ message: 'Horários salvos!' });
    } catch (error) {
        if (conn) await conn.rollback();
        console.error("Erro ao salvar disponibilidade:", error);
        res.status(500).json({ message: 'Erro ao salvar disponibilidade.', details: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// ===================================================================
// --- NOVAS ROTAS PARA GERENCIAR A DISPONIBILIDADE ---
// ===================================================================

// Rota para o ADMIN VISUALIZAR TODOS os seus horários de disponibilidade
router.get('/availability/admin', protect, isAdmin, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();

        // 1. AJUSTE: Executa la limpeza de horários antigos e não agendados
        // Deleta apenas horários com mais de 15 dias que não foram agendados.
        await conn.query(
            "DELETE FROM admin_availability WHERE is_booked = FALSE AND start_time < NOW() - INTERVAL 15 DAY"
        );

        // 2. AJUSTE: Busca os horários relevantes para o admin gerenciar
        // (todos os futuros + os dos últimos 15 dias, agendados ou não)
        const slots = await conn.query(
            "SELECT id, start_time, end_time, is_booked FROM admin_availability WHERE start_time >= NOW() - INTERVAL 15 DAY ORDER BY start_time DESC"
        );
        
        res.json(serializeBigInts(slots));
    } catch (error) {
        console.error("Erro ao buscar/limpar horários disponíveis:", error);
        res.status(500).json({ message: 'Não foi possível carregar os horários.' });
    } finally {
        if (conn) conn.release();
    }
});

// Rota para o ADMIN ATUALIZAR um horário de disponibilidade
router.patch('/availability/:id', protect, isAdmin, async (req, res) => {
    const { id } = req.params;
    const { start_time, end_time } = req.body;
    if (!start_time || !end_time) {
        return res.status(400).json({ message: 'Data/hora de início e fim são obrigatórias.' });
    }
    let conn;
    try {
        conn = await pool.getConnection();
        const [slot] = await conn.query("SELECT is_booked FROM admin_availability WHERE id = ?", [id]);
        if (slot && slot.is_booked) {
            return res.status(409).json({ message: 'Não é possível editar um horário que já foi agendado.' });
        }
        const result = await conn.query('UPDATE admin_availability SET start_time = ?, end_time = ? WHERE id = ?', [new Date(start_time), new Date(end_time), id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Horário não encontrado.' });
        }
        res.json({ message: 'Horário atualizado com sucesso.' });
    } catch (error) {
        console.error("Erro ao atualizar disponibilidade:", error);
        res.status(500).json({ message: 'Erro ao atualizar disponibilidade.' });
    } finally {
        if (conn) conn.release();
    }
});

// Rota para o ADMIN DELETAR um horário de disponibilidade
router.delete('/availability/:id', protect, isAdmin, async (req, res) => {
    const { id } = req.params;
    let conn;
    try {
        conn = await pool.getConnection();
        const [slot] = await conn.query("SELECT is_booked FROM admin_availability WHERE id = ?", [id]);
        if (slot && slot.is_booked) {
            return res.status(409).json({ message: 'Não é possível excluir um horário que já foi agendado.' });
        }
        const result = await conn.query('DELETE FROM admin_availability WHERE id = ?', [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Horário não encontrado.' });
        }
        res.json({ message: 'Horário de disponibilidade excluído com sucesso.' });
    } catch (error) {
        console.error("Erro ao excluir disponibilidade:", error);
        res.status(500).json({ message: 'Erro ao excluir disponibilidade.' });
    } finally {
        if (conn) conn.release();
    }
});


// Rota para o ADMIN VISUALIZAR agendamentos confirmados
router.get('/scheduled', protect, isAdmin, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        
        // --- MODIFICADO: Adicionado LEFT JOINs e COALESCE para buscar o telefone ---
        const query = `
            SELECT 
                ta.id, ta.triagem_id, ta.user_name, ta.triagem_type, ta.meeting_link, aa.start_time,
                COALESCE(tp.telefone, tpr.telefone, te.telefone) as telefone
            FROM triagem_appointments ta
            JOIN admin_availability aa ON ta.availability_id = aa.id
            LEFT JOIN triagem_pacientes tp ON ta.triagem_id = tp.id AND ta.triagem_type = 'pacientes'
            LEFT JOIN triagem_profissionais tpr ON ta.triagem_id = tpr.id AND ta.triagem_type = 'profissionais'
            LEFT JOIN triagem_empresas te ON ta.triagem_id = te.id AND ta.triagem_type = 'empresas'
            WHERE ta.status = 'Confirmado' AND aa.start_time >= NOW()
            ORDER BY aa.start_time ASC
        `;
        
        const appointments = await conn.query(query);
        res.json(serializeBigInts(appointments));
    } catch (error) {
        console.error("Erro ao buscar agendamentos confirmados:", error);
        res.status(500).json({ message: 'Erro ao buscar agendamentos.' });
    } finally {
        if (conn) conn.release();
    }
});

// Rota para o ADMIN CONFIRMAR um agendamento e adicionar o link da reunião
router.patch('/appointments/:id/confirm', protect, isAdmin, async (req, res) => {
    const { id } = req.params;
    const { meeting_link } = req.body;
    if (!meeting_link) {
        return res.status(400).json({ message: 'O link da reunião é obrigatório.' });
    }
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();

        const result = await conn.query("UPDATE triagem_appointments SET status = 'Confirmado', meeting_link = ? WHERE id = ?", [meeting_link, id]);
        if (result.affectedRows === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Agendamento não encontrado.' });
        }

        const appointmentDetailsRows = await conn.query(`
            SELECT ta.user_name, ta.user_email, aa.start_time FROM triagem_appointments ta
            JOIN admin_availability aa ON ta.availability_id = aa.id WHERE ta.id = ?`, [id]
        );
        
        await conn.commit();

        if (appointmentDetailsRows && appointmentDetailsRows.length > 0) {
            const details = appointmentDetailsRows[0];
            await sendConfirmationEmail(details.user_email, details.user_name, details.start_time, meeting_link);
        }
        
        res.json({ message: 'Agendamento confirmado e e-mail enviado com sucesso!' });
    } catch (error) {
        if (conn) await conn.rollback();
        console.error("Erro ao confirmar agendamento:", error);
        res.status(500).json({ message: 'Erro ao confirmar agendamento.' });
    } finally {
        if (conn) conn.release();
    }
});



// --- ROTAS PÚBLICAS (PARA O USUÁRIO AGENDAR) ---

// Rota para o USUÁRIO ver os horários disponíveis
router.get('/availability/public', async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        const slots = await conn.query("SELECT id, start_time FROM admin_availability WHERE is_booked = FALSE AND start_time > NOW() ORDER BY start_time ASC");
        res.json(serializeBigInts(slots));
    } catch (error) {
        console.error("Erro ao buscar horários disponíveis:", error);
        res.status(500).json({ message: 'Não foi possível carregar os horários.' });
    } finally {
        if (conn) conn.release();
    }
});

// Rota para o USUÁRIO criar um agendamento
router.post('/appointments/public', async (req, res) => {
    const { availability_id, triagem_id, triagem_type, user_email, user_name } = req.body;
    if (!availability_id || !triagem_id || !triagem_type || !user_email || !user_name) {
        return res.status(400).json({ message: 'Todos os campos são obrigatórios para agendar.' });
    }
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();
        const [slot] = await conn.query("SELECT * FROM admin_availability WHERE id = ? FOR UPDATE", [availability_id]);
        if (!slot || slot.is_booked) {
            await conn.rollback();
            return res.status(409).json({ message: 'Este horário não está mais disponível. Por favor, escolha outro.' });
        }
        await conn.query('INSERT INTO triagem_appointments (availability_id, triagem_id, triagem_type, user_email, user_name) VALUES (?, ?, ?, ?, ?)', [availability_id, triagem_id, triagem_type, user_email, user_name]);
        await conn.query('UPDATE admin_availability SET is_booked = TRUE WHERE id = ?', [availability_id]);
        await conn.commit();
        res.status(201).json({ message: 'Seu horário foi solicitado com sucesso! Você receberá uma confirmação em breve.' });
    } catch (error) {
        if (conn) await conn.rollback();
        console.error("Erro ao criar agendamento público:", error);
        res.status(500).json({ message: 'Erro ao processar seu agendamento.' });
    } finally {
        if (conn) conn.release();
    }
});

router.post('/send-schedule-link', protect, isAdmin, async (req, res) => {
    const { email, name, scheduleLink } = req.body;

    if (!email || !name || !scheduleLink) {
        return res.status(400).json({ message: 'Dados insuficientes para enviar o e-mail.' });
    }

    try {
        await sendSchedulingEmail(email, name, scheduleLink);
        res.status(200).json({ message: 'E-mail de agendamento enviado com sucesso!' });
    } catch (error) {
        console.error("Falha na rota /send-schedule-link:", error);
        res.status(500).json({ message: 'Erro ao disparar o e-mail.' });
    }
});

// Rota para o ADMIN VISUALIZAR agendamentos PENDENTES
router.get('/pending', protect, isAdmin, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        
        // --- MODIFICADO: Adicionado LEFT JOINs e COALESCE para buscar o telefone ---
        const appointments = await conn.query(`
            SELECT 
                ta.id, ta.triagem_id, ta.user_name, ta.user_email, ta.triagem_type, aa.start_time,
                COALESCE(tp.telefone, tpr.telefone, te.telefone) as telefone
            FROM triagem_appointments ta
            JOIN admin_availability aa ON ta.availability_id = aa.id
            LEFT JOIN triagem_pacientes tp ON ta.triagem_id = tp.id AND ta.triagem_type = 'pacientes'
            LEFT JOIN triagem_profissionais tpr ON ta.triagem_id = tpr.id AND ta.triagem_type = 'profissionais'
            LEFT JOIN triagem_empresas te ON ta.triagem_id = te.id AND ta.triagem_type = 'empresas'
            WHERE ta.status = 'Pendente'
            ORDER BY aa.start_time ASC
        `);
        res.json(serializeBigInts(appointments));
    } catch (error) {
        console.error("Erro ao buscar agendamentos pendentes:", error);
        res.status(500).json({ message: 'Erro ao buscar agendamentos pendentes.' });
    } finally {
        if (conn) conn.release();
    }
});

// Rota para o ADMIN ATUALIZAR um agendamento (NOVA)
router.patch('/appointments/:id/update', protect, isAdmin, async (req, res) => {
    const { id } = req.params;
    const { meeting_link } = req.body; 

    if (!meeting_link) {
        return res.status(400).json({ message: 'O link da reunião é obrigatório.' });
    }

    let conn;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();

        const [result] = await conn.query(
            "UPDATE triagem_appointments SET meeting_link = ? WHERE id = ?",
            [meeting_link, id]
        );
        
        if (result.affectedRows === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Agendamento não encontrado.' });
        }

        const [details] = await conn.query(`
            SELECT ta.user_name, ta.user_email, aa.start_time FROM triagem_appointments ta
            JOIN admin_availability aa ON ta.availability_id = aa.id WHERE ta.id = ?`, [id]
        );
        
        await conn.commit();

        if (details) {
            await sendUpdateEmail(details.user_email, details.user_name, details.start_time, meeting_link);
        }
        
        res.json({ message: 'Agendamento atualizado e usuário notificado!' });
    } catch (error) {
        if (conn) await conn.rollback();
        console.error("Erro ao atualizar agendamento:", error);
        res.status(500).json({ message: 'Erro ao atualizar agendamento.' });
    } finally {
        if (conn) conn.release();
    }
});

// ROTA PARA O ADMIN CANCELAR UM AGENDAMENTO E REABRIR O SLOT NA AGENDA
router.patch('/appointments/:id/cancel', protect, isAdmin, async (req, res) => {
    const { id } = req.params; 
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();

        const [appointment] = await conn.query("SELECT availability_id FROM triagem_appointments WHERE id = ?", [id]);
        if (!appointment) {
            await conn.rollback();
            return res.status(404).json({ message: 'Agendamento não encontrado.' });
        }

        await conn.query("UPDATE triagem_appointments SET status = 'Pendente', meeting_link = NULL WHERE id = ?", [id]);
        await conn.query("UPDATE admin_availability SET is_booked = FALSE WHERE id = ?", [appointment.availability_id]);

        await conn.commit();
        res.json({ message: 'Agendamento movido para pendentes e horário liberado com sucesso!' });
    } catch (error) {
        if (conn) await conn.rollback();
        console.error("Erro ao cancelar agendamento:", error);
        res.status(500).json({ message: 'Erro ao cancelar agendamento.' });
    } finally {
        if (conn) conn.release();
    }
});


// ROTA PARA O ADMIN REAGENDAR E NOTIFICAR O USUÁRIO
router.patch('/appointments/:id/reschedule', protect, isAdmin, async (req, res) => {
    const { id } = req.params;
    const { new_availability_id, meeting_link } = req.body;

    if (!new_availability_id || !meeting_link) {
        return res.status(400).json({ message: 'Um novo horário e um link de reunião são obrigatórios.' });
    }

    let conn;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();

        const [oldAppointment] = await conn.query("SELECT availability_id, user_name, user_email FROM triagem_appointments WHERE id = ?", [id]);
        if (!oldAppointment) {
            await conn.rollback();
            return res.status(404).json({ message: 'Agendamento original não encontrado.' });
        }

        await conn.query("UPDATE admin_availability SET is_booked = FALSE WHERE id = ?", [oldAppointment.availability_id]);
        await conn.query("UPDATE admin_availability SET is_booked = TRUE WHERE id = ?", [new_availability_id]);
        
        await conn.query(
            "UPDATE triagem_appointments SET availability_id = ?, meeting_link = ?, status = 'Confirmado' WHERE id = ?",
            [new_availability_id, meeting_link, id]
        );

        const [newSlot] = await conn.query("SELECT start_time FROM admin_availability WHERE id = ?", [new_availability_id]);

        await conn.commit();

        const [userToNotify] = await conn.query("SELECT id FROM users WHERE email = ?", [oldAppointment.user_email]);
        if (userToNotify) {
            const newDateTime = new Date(newSlot.start_time).toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' });
            await createNotification(
                req,
                userToNotify.id,
                'appointment_rescheduled',
                `Sua entrevista foi reagendada para ${newDateTime}.`,
                '/paciente/agenda' 
            );
        }

        if (newSlot) {
            await sendUpdateEmail(
                oldAppointment.user_email,
                oldAppointment.user_name,
                newSlot.start_time,
                meeting_link
            );
        }
        
        res.json({ message: 'Agendamento reagendado e usuário notificado com sucesso!' });
    } catch (error) {
        if (conn) await conn.rollback();
        console.error("Erro ao reagendar:", error);
        res.status(500).json({ message: 'Erro ao reagendar.' });
    } finally {
        if (conn) conn.release();
    }
});


module.exports = router;