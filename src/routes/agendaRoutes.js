// server/src/routes/agendaRoutes.js
const express = require('express');
const pool = require('../config/db.js');
const { protect, isAdmin, isProfissional } = require('../middleware/authMiddleware.js');
// CORREÇÃO: Importando a função correta
const { sendSchedulingEmail, sendInvoiceNotificationEmail } = require('../config/mailer.js'); 
const { createNotification } = require('../services/notificationService.js');
const router = express.Router();


// Função auxiliar para converter BigInt para String
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

// Busca detalhes de uma série e suas futuras ocorrências
router.get('/series/:seriesId', protect, async (req, res) => {
    const { seriesId } = req.params;
    let conn;
    try {
        conn = await pool.getConnection();
        
        // Busca a regra da série (frequência)
        const seriesInfo = await conn.query("SELECT frequency FROM appointment_series WHERE id = ?", [seriesId]);
        
        if (!seriesInfo || seriesInfo.length === 0) {
            // Se não encontrar a série, retorna um objeto vazio para não quebrar o frontend
            return res.json({ frequency: 'Evento Único', occurrences: [] });
        }

        // Busca todas as ocorrências futuras da série que ainda estão agendadas
        const occurrences = await conn.query(
            "SELECT id, appointment_time FROM appointments WHERE series_id = ? AND status = 'Agendada' AND appointment_time >= NOW() ORDER BY appointment_time ASC",
            [seriesId]
        );

        res.json({
            frequency: seriesInfo[0].frequency,
            occurrences: serializeBigInts(occurrences) || []
        });

    } catch (error) {
        console.error("Erro ao buscar detalhes da série:", error);
        res.status(500).json({ message: 'Erro ao buscar detalhes da série.' });
    } finally {
        if (conn) conn.release();
    }
});


// --- ROTAS DO ADMIN ---

// Rota para buscar os usuários para o modal de criação de agenda
router.get('/users-for-agenda', protect, isAdmin, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        const professionalsRows = await conn.query("SELECT id, nome FROM professionals");
        const patientsRows = await conn.query("SELECT id, nome FROM patients");
        const companiesRows = await conn.query("SELECT id, nome_empresa FROM companies");
        
        res.json({
            professionals: serializeBigInts(professionalsRows),
            patients: serializeBigInts(patientsRows),
            companies: serializeBigInts(companiesRows),
        });
    } catch (error) {
        console.error("Erro ao buscar dados para agenda:", error);
        res.status(500).json({ message: 'Erro ao buscar dados para agenda.' });
    } finally {
        if (conn) conn.release();
    }
});

// Rota para o ADMIN buscar TODOS os agendamentos com detalhes
/*
router.get('/all-appointments', protect, isAdmin, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        const query = `
            SELECT 
                a.id, a.appointment_time, a.status,
                a.session_value,
                prof.id as professional_id, prof.nome as professional_name, prof.imagem_url as professional_photo,
                pat.id as patient_id, pat.nome as patient_name, pat.imagem_url as patient_photo,
                comp.nome_empresa as company_name
            FROM appointments a
            JOIN professionals prof ON a.professional_id = prof.id
            JOIN patients pat ON a.patient_id = pat.id
            LEFT JOIN companies comp ON pat.company_id = comp.id
            ORDER BY a.appointment_time DESC;
        `;
        const appointments = await conn.query(query);
        res.json(serializeBigInts(appointments));
    } catch (error) {
        console.error("Erro ao buscar todos os agendamentos:", error);
        res.status(500).json({ message: 'Erro ao buscar agendamentos.' });
    } finally {
        if (conn) conn.release();
    }
});
*/
router.get('/all-appointments', protect, isAdmin, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        // ATUALIZAÇÃO: Adicionada a lógica CASE para criar o campo 'is_pending_review'
        const query = `
            SELECT 
                a.id, a.appointment_time, a.status,
                a.session_value,
                prof.id as professional_id, prof.nome as professional_name, prof.imagem_url as professional_photo,
                pat.id as patient_id, pat.nome as patient_name, pat.imagem_url as patient_photo,
                comp.nome_empresa as company_name,
                CASE
                    WHEN 
                        a.status = 'Agendada' 
                        AND a.appointment_time < (NOW() - INTERVAL 3 HOUR - INTERVAL 24 HOUR)
                        AND a.package_invoice_id IS NULL
                    THEN 1
                    ELSE 0
                END AS is_pending_review
            FROM appointments a
            JOIN professionals prof ON a.professional_id = prof.id
            JOIN patients pat ON a.patient_id = pat.id
            LEFT JOIN companies comp ON pat.company_id = comp.id
            ORDER BY a.appointment_time DESC;
        `;
        const appointments = await conn.query(query);
        res.json(serializeBigInts(appointments));
    } catch (error) {
        console.error("Erro ao buscar todos os agendamentos:", error);
        res.status(500).json({ message: 'Erro ao buscar agendamentos.' });
    } finally {
        if (conn) conn.release();
    }
});

// Rota para criar um agendamento
/*
router.post('/create-appointment', protect, isAdmin, async (req, res) => {
    const { professional_id, patient_id, company_id, session_value, frequency, appointment_times } = req.body;
    
    if (!professional_id || !patient_id || !appointment_times || appointment_times.length === 0) {
        return res.status(400).json({ message: 'Profissional, paciente e pelo menos uma data são obrigatórios.' });
    }
    
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();

        if (company_id) {
            await conn.query('UPDATE patients SET company_id = ? WHERE id = ?', [company_id, patient_id]);
        }
        await conn.query('INSERT IGNORE INTO professional_assignments (professional_id, patient_id) VALUES (?, ?)', [professional_id, patient_id]);
        
        const initialDate = new Date(appointment_times[0]);
        let appointmentsToCreate = [];
        let newSeriesId = null;

        if (frequency === 'Evento Único') {
            appointment_times.forEach(time => {
                appointmentsToCreate.push({
                    series_id: null,
                    professional_id: professional_id,
                    patient_id: patient_id,
                    appointment_time: time,
                    session_value: session_value || null
                });
            });
        } else {
            const seriesResult = await conn.query(
                'INSERT INTO appointment_series (professional_id, patient_id, start_date, frequency, session_value) VALUES (?, ?, ?, ?, ?)',
                [professional_id, patient_id, initialDate, frequency, session_value]
            );
            newSeriesId = seriesResult.insertId;

            let currentDate = initialDate;
            const endDate = new Date();
            endDate.setMonth(initialDate.getMonth() + 3);
            const increment = (frequency === 'Semanalmente') ? 7 : 14;

            while (currentDate <= endDate) {
                appointmentsToCreate.push({
                    series_id: newSeriesId,
                    professional_id: professional_id,
                    patient_id: patient_id,
                    appointment_time: new Date(currentDate),
                    session_value: session_value || null
                });
                currentDate.setDate(currentDate.getDate() + increment);
            }
        }
        
        // ===================================================================
        // CORREÇÃO: Usando um loop para inserir cada agendamento individualmente.
        // Isso é mais robusto e evita o erro de sintaxe.
        // ===================================================================
        if (appointmentsToCreate.length > 0) {
            for (const app of appointmentsToCreate) {
                await conn.query(
                    'INSERT INTO appointments (series_id, professional_id, patient_id, appointment_time, session_value) VALUES (?, ?, ?, ?, ?)', 
                    [app.series_id, app.professional_id, app.patient_id, app.appointment_time, app.session_value]
                );
            }
        }
        
        await conn.commit();
        res.status(201).json({ message: `${appointmentsToCreate.length} agendamento(s) criado(s) com sucesso!` });
    } catch (error) {
        if (conn) await conn.rollback();
        console.error("Erro ao criar agendamento:", error);
        res.status(500).json({ message: 'Erro ao criar agendamento.' });
    } finally {
        if (conn) conn.release();
    }
});
*/


router.post('/create-appointment', protect, isAdmin, async (req, res) => {
    // Esta rota agora usa a mesma lógica do profissional, mas é executada pelo Admin
    const { professional_id, patient_id, company_id, session_value, 
        frequency, appointment_times, is_package, 
        discount_percentage, total_value } = req.body;
    
    // O 'userId' aqui é do ADMIN logado
    const { userId } = req.user; 

    if (!professional_id || !patient_id || !appointment_times || !Array.isArray(appointment_times) || appointment_times.length === 0) {
        return res.status(400).json({ message: 'Profissional, paciente e pelo menos uma data são obrigatórios.' });
    }

    let conn;
    let newPackageInvoiceId = null;
    let appointmentsCreatedCount = 0;
    
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();

        // MODIFICAÇÃO: O Admin busca o nome do profissional (não verifica o 'level')
        const [profProfile] = await conn.query("SELECT nome FROM professionals WHERE id = ?", [professional_id]);
        if (!profProfile) {
            await conn.rollback();
            return res.status(404).json({ message: 'Profissional selecionado não encontrado.' });
        }
        const professionalName = profProfile.nome;
        // FIM DA MODIFICAÇÃO

        if (company_id) {
            await conn.query('UPDATE patients SET company_id = ? WHERE id = ?', [company_id, patient_id]);
        }
        await conn.query('INSERT IGNORE INTO professional_assignments (professional_id, patient_id) VALUES (?, ?)', [professional_id, patient_id]);
        
        const appointmentsToCreate = [];
        const initialDate = new Date(appointment_times[0]);

        // ==========================================================
        // --- LÓGICA DE CRIAÇÃO DE PACOTE E FATURA (COPIADA DO PROFISSIONAL) ---

        // let newPackageInvoiceId = null; // Já declarado
        let newStatus = 'Agendada'; // Padrão
        let recipientUserId = null;
        let recipientName = '';
        let recipientEmail = '';
        let recipientType = '';

        // CORREÇÃO: Define 'Aguardando Pagamento' se for pacote com valor
        if (is_package && total_value > 0) {
            newStatus = 'Aguardando Pagamento'; // <-- ESTA É A CORREÇÃO PRINCIPAL

            // 1. Identifica o pagador (paciente ou empresa)
            const [patientDetails] = await conn.query("SELECT user_id, company_id, nome FROM patients WHERE id = ?", [patient_id]);
            if (patientDetails) {
                if (patientDetails.company_id) {
                    const [companyDetails] = await conn.query("SELECT u.id as user_id, c.nome_empresa as name, u.email FROM companies c JOIN users u ON c.user_id = u.id WHERE c.id = ?", [patientDetails.company_id]);
                    if (companyDetails) {
                        recipientUserId = companyDetails.user_id;
                        recipientName = companyDetails.name;
                        recipientEmail = companyDetails.email;
                        recipientType = 'empresa';
                    }
                }
                if (!recipientUserId) { // Se não tiver empresa, cobra o paciente
                    const [userPatientDetails] = await conn.query("SELECT u.id as user_id, p.nome as name, u.email FROM patients p JOIN users u ON p.user_id = u.id WHERE p.id = ?", [patient_id]);
                    if (userPatientDetails) {
                        recipientUserId = userPatientDetails.user_id;
                        recipientName = userPatientDetails.name;
                        recipientEmail = userPatientDetails.email;
                        recipientType = 'paciente';
                    }
                }
            }

            // 2. Se encontrou um pagador, cria a fatura
            if (recipientUserId) {
                const dueDate = new Date();
                dueDate.setDate(dueDate.getDate() + 7); // Vencimento em 7 dias
                const description = `Pacote de ${appointment_times.length} sessões com ${professionalName}. Desconto de ${discount_percentage}%.`;

                const invoiceResult = await conn.query(
                    'INSERT INTO invoices (user_id, creator_user_id, amount, due_date, description, status) VALUES (?, ?, ?, ?, ?, ?)',
                    // 'userId' aqui é o ID do Admin (o criador da fatura)
                    [recipientUserId, userId, total_value, dueDate, description, 'pending']
                );
                newPackageInvoiceId = invoiceResult.insertId; // Vincula os agendamentos a esta fatura
                
            } else {
                await conn.rollback();
                return res.status(400).json({ message: 'Não foi possível identificar um destinatário para a fatura do pacote.' });
            }
        }
        // Se for pacote E total_value for 0, o status permanece 'Agendada' e newPackageInvoiceId permanece null (correto)

        // ==========================================================
        // --- EVENTO UNICO ---

        if (frequency === 'Evento Único' || is_package) { // Pacotes são sempre 'Evento Único'
            appointment_times.forEach(time => {
                appointmentsToCreate.push({
                    series_id: null,
                    professional_id: professional_id,
                    patient_id: patient_id,
                    appointment_time: time,
                    session_value: session_value || null,
                    status: newStatus, // <-- Usa o status corrigido
                    package_invoice_id: newPackageInvoiceId // <-- Usa o ID da fatura
                });
            });
        } else { // Lógica de recorrência (não é pacote)
             const seriesResult = await conn.query('INSERT INTO appointment_series (professional_id, patient_id, start_date, frequency, session_value) VALUES (?, ?, ?, ?, ?)', [professional_id, patient_id, initialDate, frequency, session_value]);
             const newSeriesId = seriesResult.insertId;
             let currentDate = initialDate;
             const endDate = new Date();
             endDate.setMonth(initialDate.getMonth() + 3);
             const increment = (frequency === 'Semanalmente') ? 7 : 14;
             while (currentDate <= endDate) {
                 appointmentsToCreate.push({ 
                     series_id: newSeriesId, professional_id, patient_id, 
                     appointment_time: new Date(currentDate), 
                     session_value: session_value || null,
                     status: newStatus, // 'Agendada'
                     package_invoice_id: null
                 });
                 currentDate.setDate(currentDate.getDate() + increment);
             }
        }
        
        // Query de inserção ATUALIZADA para incluir status e package_invoice_id
        for (const app of appointmentsToCreate) {
            await conn.query(
                'INSERT INTO appointments (series_id, professional_id, patient_id, appointment_time, session_value, status, package_invoice_id) VALUES (?, ?, ?, ?, ?, ?, ?)', 
                [app.series_id, app.professional_id, app.patient_id, app.appointment_time, app.session_value, app.status, app.package_invoice_id]
            );
        }

        appointmentsCreatedCount = appointmentsToCreate.length;
        
        await conn.commit();

        // Se for pacote (e tiver fatura), notifica sobre a fatura
        if (is_package && recipientUserId && newPackageInvoiceId) {
            try { 
                await createNotification(
                    req,
                    recipientUserId,
                    'new_invoice',
                    `Nova cobrança de pacote (${professionalName}) no valor de ${total_value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`,
                    `/${recipientType}/financeiro`
                );

                if (recipientEmail) {
                    await sendInvoiceNotificationEmail(
                        recipientEmail,
                        recipientName,
                        professionalName, // Nome do profissional
                        total_value,
                        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Due date
                        newPackageInvoiceId,
                        `https://integrandoser.com.br/${recipientType}/financeiro`
                    );
                }
            } catch (emailOrNotificationError) {
                console.error(`AVISO: Pacote ${newPackageInvoiceId} (Admin) criado, mas notificação/email falhou:`, emailOrNotificationError);
            }
        }

        // Notificação padrão de agendamento (para todos os casos)
        const [patientUser] = await conn.query("SELECT user_id, nome, email FROM patients p JOIN users u ON p.user_id = u.id WHERE p.id = ?", [patient_id]);
        if (patientUser && patientUser.user_id) {
            const appointmentDate = new Date(appointment_times[0]).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
            
            // Mensagem diferente se for pacote
            const message = is_package && newStatus === 'Aguardando Pagamento'
                ? `O admin pré-agendou ${appointment_times.length} sessões com ${professionalName}. A confirmação ocorrerá após o pagamento da fatura.`
                : `O admin agendou uma nova consulta (${professionalName}) para você em ${appointmentDate}.`;
            
            await createNotification(
                req, 
                patientUser.user_id, 
                'new_appointment', 
                message,
                '/paciente/agenda'
            );
            
            // Notifica o Profissional
            const [profUser] = await conn.query("SELECT user_id FROM professionals WHERE id = ?", [professional_id]);
            if (profUser && profUser.user_id) {
                await createNotification(req, profUser.user_id, 'new_appointment', `Novo agendamento (criado por Admin) com ${patientUser.nome} adicionado para ${appointmentDate}.`, '/professional/agenda');
            }

            // Envia e-mail de agendamento (apenas se não for pacote pendente)
            if (!is_package || newStatus === 'Agendada') {
                try {
                    await sendSchedulingEmail(
                        patientUser.email,
                        patientUser.nome,
                        professionalName,
                        new Date(appointment_times[0])
                    );
                } catch (emailError) {
                    console.error("AVISO: Agendamento (Admin) criado, mas e-mail de confirmação falhou.", emailError);
                }
            }
        }
        
        res.status(201).json({ message: `${appointmentsToCreate.length} agendamento(s) criado(s) com sucesso!` });

    } catch (error) {
        if (conn) await conn.rollback();
        console.error("Erro ao criar agendamento pelo Admin:", error);
        res.status(500).json({ message: 'Erro interno no servidor ao processar o agendamento.' });
    } finally {
        if (conn) conn.release();
    }
});


// Rota para o ADMIN DELETAR um agendamento
router.delete('/appointments/:id', protect, isAdmin, async (req, res) => {
    const { id } = req.params;
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query('DELETE FROM appointments WHERE id = ?', [id]);
        res.json({ message: 'Agendamento removido com sucesso.' });
    } catch (error) {
        console.error("Erro ao remover agendamento:", error);
        res.status(500).json({ message: 'Erro ao remover agendamento.' });
    } finally {
        if (conn) conn.release();
    }
});


// Rota para o ADMIN ATUALIZAR um agendamento
router.put('/appointments/:id', protect, isAdmin, async (req, res) => {
    const { id } = req.params;
    const { professional_id, patient_id, company_id, appointment_time, session_value } = req.body;

    let conn;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();

        // NOVO: Lógica para construir a query de atualização dinamicamente
        const fieldsToUpdate = [];
        const values = [];

        if (professional_id !== undefined) {
            fieldsToUpdate.push('professional_id = ?');
            values.push(professional_id);
        }
        if (patient_id !== undefined) {
            fieldsToUpdate.push('patient_id = ?');
            values.push(patient_id);
        }
        if (appointment_time !== undefined) {
            fieldsToUpdate.push('appointment_time = ?');
            values.push(appointment_time);
        }
        if (session_value !== undefined) {
            fieldsToUpdate.push('session_value = ?');
            values.push(session_value);
        }

        // NOVO: Validação para garantir que pelo menos um campo foi enviado para atualização
        if (fieldsToUpdate.length === 0 && company_id === undefined) {
            await conn.rollback();
            return res.status(400).json({ message: 'Nenhum campo para atualizar foi fornecido.' });
        }

        // NOVO: Busca o agendamento original para garantir que temos os dados para as notificações
        const [originalAppointment] = await conn.query("SELECT professional_id, patient_id FROM appointments WHERE id = ?", [id]);
        if (!originalAppointment) {
            await conn.rollback();
            return res.status(404).json({ message: 'Agendamento não encontrado.' });
        }

        // Executa a atualização apenas se houver campos na tabela 'appointments' para alterar
        if (fieldsToUpdate.length > 0) {
            const setClause = fieldsToUpdate.join(', ');
            const query = `UPDATE appointments SET ${setClause} WHERE id = ?`;
            values.push(id);
            await conn.query(query, values);
        }

        // Atualiza a empresa do paciente, se fornecido
        if (company_id !== undefined) {
            const finalPatientId = patient_id !== undefined ? patient_id : originalAppointment.patient_id;
            await conn.query('UPDATE patients SET company_id = ? WHERE id = ?', [company_id, finalPatientId]);
        }
        
        await conn.commit();

        // Lógica de notificação aprimorada
        const finalPatientId = patient_id !== undefined ? patient_id : originalAppointment.patient_id;
        const finalProfId = professional_id !== undefined ? professional_id : originalAppointment.professional_id;
        const finalAppointmentTime = appointment_time || new Date(); // Usa o novo horário ou data atual como fallback para a mensagem

        const [patientUser] = await conn.query("SELECT user_id FROM patients WHERE id = ?", [finalPatientId]);
        const [profUser] = await conn.query("SELECT user_id FROM professionals WHERE id = ?", [finalProfId]);
        const appointmentDate = new Date(finalAppointmentTime).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

        if (patientUser && patientUser.user_id) {
            await createNotification(req, patientUser.user_id, 'appointment_rescheduled', `Seu agendamento foi alterado para ${appointmentDate}.`, '/paciente/agenda');
        }
        if (profUser && profUser.user_id) {
            await createNotification(req, profUser.user_id, 'appointment_rescheduled', `Um agendamento foi alterado para ${appointmentDate}. Verifique sua agenda.`, '/professional/agenda');
        }

        res.json({ message: 'Agendamento atualizado com sucesso!' });
    } catch (error) {
        if (conn) await conn.rollback();
        console.error("Erro ao atualizar agendamento:", error);
        res.status(500).json({ message: 'Erro ao atualizar agendamento.' });
    } finally {
        if (conn) conn.release();
    }
});


// --- ROTAS DAS AGENDAS DOS PERFIS ---

// Rota para agenda do PACIENTE
router.get('/my-appointments/patient', protect, async (req, res) => {
    const { userId } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();
        const query = `
            SELECT 
                a.id, a.appointment_time, a.status,
                a.session_value, 
                prof.id as professional_id, prof.user_id as professional_user_id, prof.nome AS professional_name, prof.imagem_url as professional_photo
            FROM appointments a
            JOIN professionals prof ON a.professional_id = prof.id
            JOIN patients pat ON a.patient_id = pat.id
            WHERE pat.user_id = ? ORDER BY prof.nome, a.appointment_time ASC;
        `;
        const rows = await conn.query(query, [userId]);
        res.json(serializeBigInts(rows));
    } catch (error) {
        console.error("Erro ao buscar agendamentos do paciente:", error);
        res.status(500).json({ message: 'Erro ao buscar agendamentos.' });
    } finally {
        if (conn) conn.release();
    }
});


// Rota para agenda da EMPRESA
router.get('/my-appointments/company', protect, async (req, res) => {
    const { userId } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();
        const companies = await conn.query('SELECT id FROM companies WHERE user_id = ?', [userId]);
        if (!companies || companies.length === 0) {
            return res.status(404).json({ message: 'Perfil da empresa não encontrado.' });
        }
        const companyId = companies[0].id;

        // Query CORRIGIDA: Busca os agendamentos (appointments) dos pacientes da empresa
        const query = `
            SELECT 
                a.id, a.appointment_time, a.status,
                pat.user_id as patient_user_id, pat.nome as patient_name, pat.imagem_url as patient_photo,
                prof.user_id as professional_user_id, prof.nome as professional_name, prof.imagem_url as professional_photo
            FROM appointments a
            JOIN patients pat ON a.patient_id = pat.id
            JOIN professionals prof ON a.professional_id = prof.id
            WHERE pat.company_id = ?
            ORDER BY a.appointment_time DESC;
        `;
        const appointments = await conn.query(query, [companyId]);
        res.json(serializeBigInts(appointments));
    } catch (error) {
        console.error("Erro ao buscar agenda da empresa:", error);
        res.status(500).json({ message: 'Falha ao carregar agenda da empresa.' });
    } finally {
        if (conn) conn.release();
    }
});

// Busca os VÍNCULOS entre colaborador e profissional da empresa
router.get('/company/collaborator-assignments', protect, async (req, res) => {
    const { userId } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();
        const companies = await conn.query('SELECT id FROM companies WHERE user_id = ?', [userId]);
        if (!companies || companies.length === 0) {
            return res.status(404).json({ message: 'Perfil da empresa não encontrado.' });
        }
        const companyId = companies[0].id;

        // CORREÇÃO: Trocado 'JOIN' por 'LEFT JOIN' para incluir todos os pacientes da empresa,
        // mesmo que ainda não tenham um profissional vinculado.
        const query = `
            SELECT 
                pat.user_id as patient_user_id, pat.nome as patient_name, pat.imagem_url as patient_photo,
                prof.user_id as professional_user_id, prof.nome as professional_name, prof.imagem_url as professional_photo
            FROM patients pat
            LEFT JOIN professional_assignments pa ON pat.id = pa.patient_id
            LEFT JOIN professionals prof ON pa.professional_id = prof.id
            WHERE pat.company_id = ?
            ORDER BY pat.nome;
        `;
        const assignments = await conn.query(query, [companyId]);
        res.json(serializeBigInts(assignments));
    } catch (error) {
        console.error("Erro ao buscar vínculos de colaboradores:", error);
        res.status(500).json({ message: 'Falha ao carregar acompanhamento de colaboradores.' });
    } finally {
        if (conn) conn.release();
    }
});


// Rota para agenda do PROFISSIONAL
router.get('/my-appointments/professional', protect, async (req, res) => {
    const { userId } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();
        const query = `
            SELECT 
                a.id, a.appointment_time, a.status,
                a.session_value, a.package_invoice_id,
                p.id as patient_id, p.user_id as patient_user_id, p.nome AS patient_name, p.imagem_url as patient_photo,
                CASE
                    WHEN 
                        a.status = 'Agendada' 
                        AND a.appointment_time < (NOW() - INTERVAL 3 HOUR - INTERVAL 24 HOUR)
                        AND a.package_invoice_id IS NULL
                    THEN 1
                    ELSE 0
                END AS is_pending_review
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            JOIN professionals prof ON a.professional_id = prof.id
            WHERE prof.user_id = ? 
            ORDER BY a.appointment_time ASC;
        `;
        const rows = await conn.query(query, [userId]);
        res.json(serializeBigInts(rows));
    } catch (error) {
        console.error("Erro ao buscar agendamentos do profissional:", error);
        res.status(500).json({ message: 'Erro ao buscar agendamentos.' });
    } finally {
        if (conn) conn.release();
    }
});



// Rota para o DASHBOARD do PROFISSIONAL
router.get('/my-dashboard/professional', protect, isProfissional, async (req, res) => {
    const { userId } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();
        const [profProfile] = await conn.query("SELECT id, nome FROM professionals WHERE user_id = ?", [userId]);

        if (!profProfile) {
            return res.status(404).json({ message: 'Perfil profissional não encontrado.' });
        }
        const professionalId = profProfile.id;

        // 1. Buscar agendamentos pendentes (passaram do horário e ainda estão como 'Agendada')
        const pendingAppointments = await conn.query(`
            SELECT a.id, a.appointment_time, p.nome as patient_name, p.imagem_url as patient_photo
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            WHERE a.professional_id = ? AND a.status = 'Agendada' AND a.appointment_time < NOW() - INTERVAL 24 HOUR
            ORDER BY a.appointment_time ASC;
        `, [professionalId]);

        // 2. Buscar próximos agendamentos (futuros)
        const upcomingAppointments = await conn.query(`
            SELECT a.id, a.appointment_time, p.nome as patient_name, p.imagem_url as patient_photo
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            WHERE a.professional_id = ? AND a.status = 'Agendada' AND a.appointment_time >= NOW()
            ORDER BY a.appointment_time ASC;
        `, [professionalId]);

        // 3. Buscar estatísticas (pacientes ativos, mensagens não lidas)
        const [patientsResult] = await conn.query("SELECT COUNT(*) AS activePatients FROM professional_assignments WHERE professional_id = ?", [professionalId]);
        const [messagesResult] = await conn.query("SELECT COUNT(*) AS newMessages FROM messages WHERE recipient_user_id = ? AND is_read = 0", [userId]);

        // 4. Calcular faturamento líquido do mês atual
        const [revenueResult] = await conn.query(`
            SELECT SUM(gross_value - commission_value) as netRevenue 
            FROM professional_billings 
            WHERE professional_id = ? AND MONTH(billing_date) = MONTH(CURDATE()) AND YEAR(billing_date) = YEAR(CURDATE())
        `, [professionalId]);
        
        // 5. Buscar atividade de sessões dos últimos 30 dias para o gráfico
        const [sessionsActivityResult] = await conn.query(`
            SELECT DATE(appointment_time) as date, COUNT(*) as count 
            FROM appointments 
            WHERE professional_id = ? AND appointment_time >= NOW() - INTERVAL 30 DAY AND status = 'Concluída'
            GROUP BY DATE(appointment_time) 
            ORDER BY date ASC
        `, [professionalId]);

        res.json({
            professionalName: profProfile.nome,
            pendingAppointments: serializeBigInts(pendingAppointments),
            upcomingAppointments: serializeBigInts(upcomingAppointments),
            activePatients: patientsResult ? serializeBigInts(patientsResult).activePatients : 0,
            newMessages: messagesResult ? serializeBigInts(messagesResult).newMessages : 0,
            netRevenue: revenueResult ? revenueResult.netRevenue : 0,
            sessionsActivity: sessionsActivityResult || []
        });

    } catch (error) {
        console.error("Erro ao buscar dados do dashboard do profissional:", error);
        res.status(500).json({ message: 'Erro ao carregar dados do dashboard.' });
    } finally {
        if (conn) conn.release();
    }
});

// Rota para buscar o histórico de agendamentos entre o Profissional logado e um Paciente específico
router.get('/professional/patient-history/:patientUserId', protect, isProfissional, async (req, res) => {
    const { userId } = req.user; // ID do profissional (tabela users)
    const { patientUserId } = req.params; // ID do paciente (tabela users)
    let conn;

    try {
        conn = await pool.getConnection();

        // 1. Identifica o ID do Profissional na tabela professionals
        const [profProfile] = await conn.query("SELECT id FROM professionals WHERE user_id = ?", [userId]);
        if (!profProfile) return res.status(404).json({ message: 'Profissional não encontrado.' });
        
        // 2. Identifica o ID do Paciente na tabela patients usando o user_id fornecido
        const [patientProfile] = await conn.query("SELECT id FROM patients WHERE user_id = ?", [patientUserId]);
        if (!patientProfile) return res.status(404).json({ message: 'Paciente não encontrado.' });

        // 3. Busca todos os agendamentos entre eles
        const query = `
            SELECT 
                a.id, 
                a.appointment_time, 
                a.status, 
                a.session_value,
                a.package_invoice_id
            FROM appointments a
            WHERE a.professional_id = ? AND a.patient_id = ?
            ORDER BY a.appointment_time DESC
        `;

        const history = await conn.query(query, [profProfile.id, patientProfile.id]);
        res.json(serializeBigInts(history));

    } catch (error) {
        console.error("Erro ao buscar histórico do paciente:", error);
        res.status(500).json({ message: 'Erro ao buscar histórico.' });
    } finally {
        if (conn) conn.release();
    }
});

// Rota para buscar agendamentos futuros com status 'Agendada'
router.get('/future-appointments', protect, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        const query = `
            SELECT 
                a.id, a.appointment_time,
                a.session_value,
                prof.nome as professional_name, prof.imagem_url as professional_photo,
                pat.nome as patient_name, pat.imagem_url as patient_photo
            FROM appointments a
            JOIN professionals prof ON a.professional_id = prof.id
            JOIN patients pat ON a.patient_id = pat.id
            WHERE a.status = 'Agendada' AND a.appointment_time > NOW()
            ORDER BY a.appointment_time ASC;
        `;
        const futureAppointments = await conn.query(query);
        res.json(serializeBigInts(futureAppointments));
    } catch (error) {
        console.error("Erro ao buscar agendamentos futuros:", error);
        res.status(500).json({ message: 'Erro ao buscar agendamentos futuros.' });
    } finally {
        if (conn) conn.release();
    }
});



// Rota para o PROFISSIONAL atualizar o status de um agendamento (COM FATURAMENTO AUTOMÁTICO)
router.patch('/appointments/:id/status', protect, isProfissional, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const { userId } = req.user; // ID do profissional logado

    // Validações
    const validStatuses = ['Agendada', 'Concluída', 'Cancelada'];
    if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({ message: 'Status inválido.' });
    }

    let conn;
    // Variáveis para guardar dados necessários para notificações/e-mails PÓS-commit e PÓS-resposta
    let newInvoiceId = null;
    let recipientUserId = null;
    let recipientName = '';
    let recipientEmail = '';
    let recipientType = '';
    let grossValueForEmail = 0;
    let appointmentDetailsForEmail = null;
    let dueDateForEmail = null;
    let creatorNameForEmail = 'seu profissional'; // Nome padrão

    try {
        conn = await pool.getConnection();
        await conn.beginTransaction(); // Inicia a transação

        // Verifica se o usuário logado é um profissional válido e obtém o nome
        const [profProfile] = await conn.query('SELECT id, nome FROM professionals WHERE user_id = ?', [userId]);
        if (!profProfile || profProfile.length === 0) {
            await conn.rollback();
            return res.status(403).json({ message: 'Perfil profissional não encontrado.' });
        }
        const professionalId = profProfile.id;
        creatorNameForEmail = profProfile.nome; // Guarda o nome para usar depois

        // Busca o agendamento, seu status atual e se pertence a um pacote
        const [app] = await conn.query('SELECT professional_id, status as current_status, package_invoice_id FROM appointments WHERE id = ? FOR UPDATE', [id]); // FOR UPDATE para lock

        // Verifica permissão
        if (!app || app.professional_id.toString() !== professionalId.toString()) {
            await conn.rollback();
            return res.status(403).json({ message: 'Você não tem permissão para alterar este agendamento.' });
        }

        // Regra: Não pode mudar status (exceto Cancelar) se for de pacote pendente
        if (app.current_status === 'Aguardando Pagamento' && status !== 'Cancelada') {
            await conn.rollback();
            return res.status(403).json({ message: 'Esta consulta aguarda o pagamento do pacote. Você só pode cancelá-la.' });
        }

        // --- ATUALIZAÇÃO PRINCIPAL DO STATUS ---
        await conn.query('UPDATE appointments SET status = ? WHERE id = ?', [status, id]);

        // --- LÓGICA DE FATURAMENTO (se 'Concluída' e não for de pacote) ---
        if (status === 'Concluída' && !app.package_invoice_id) {
            const [appointmentDetails] = await conn.query(
                "SELECT professional_id, patient_id, session_value, appointment_time FROM appointments WHERE id = ?",
                [id]
            );
            appointmentDetailsForEmail = appointmentDetails; // Guarda para usar depois do commit

            if (appointmentDetails && appointmentDetails.session_value > 0) {
                grossValueForEmail = parseFloat(appointmentDetails.session_value);
                const commissionValue = grossValueForEmail * 0.25;

                // 1. Cria registro interno para comissão
                await conn.query(
                    `INSERT IGNORE INTO professional_billings (professional_id, appointment_id, billing_date, gross_value, commission_value, status) VALUES (?, ?, ?, ?, ?, ?)`,
                    [appointmentDetails.professional_id, id, new Date(appointmentDetails.appointment_time), grossValueForEmail, commissionValue, 'unbilled']
                );

                // 2. Identifica o pagador
                const [patientDetails] = await conn.query("SELECT user_id, company_id, nome FROM patients WHERE id = ?", [appointmentDetails.patient_id]);

                if (patientDetails) {
                    // Lógica para determinar recipientUserId, recipientName, recipientEmail, recipientType
                    if (patientDetails.company_id) {
                        const [companyDetails] = await conn.query(
                            "SELECT u.id as user_id, c.nome_empresa as name, u.email FROM companies c JOIN users u ON c.user_id = u.id WHERE c.id = ?",
                            [patientDetails.company_id]
                        );
                        if (companyDetails) {
                            recipientUserId = companyDetails.user_id; recipientName = companyDetails.name; recipientEmail = companyDetails.email; recipientType = 'empresa';
                        }
                    }
                    if (!recipientUserId) { // Cobra o paciente
                        const [userPatientDetails] = await conn.query(
                            "SELECT u.id as user_id, p.nome as name, u.email FROM patients p JOIN users u ON p.user_id = u.id WHERE p.id = ?",
                            [appointmentDetails.patient_id]
                        );
                        if (userPatientDetails) {
                            recipientUserId = userPatientDetails.user_id; recipientName = userPatientDetails.name; recipientEmail = userPatientDetails.email; recipientType = 'paciente';
                        }
                    }

                    // 3. Cria a fatura se encontrou pagador
                    if (recipientUserId) {
                        const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 15);
                        dueDateForEmail = dueDate; // Guarda para e-mail
                        const description = `Referente à sessão com ${patientDetails.nome} em ${new Date(appointmentDetails.appointment_time).toLocaleDateString('pt-BR')}.`;

                        const invoiceResult = await conn.query(
                            'INSERT INTO invoices (user_id, creator_user_id, amount, due_date, description, status) VALUES (?, ?, ?, ?, ?, ?)',
                            [recipientUserId, userId, grossValueForEmail, dueDate, description, 'pending']
                        );
                        // Verificar se insertId existe antes de atribuir
                        newInvoiceId = (invoiceResult && invoiceResult[0]) ? invoiceResult[0].insertId : (invoiceResult ? invoiceResult.insertId : null);
                        if (!newInvoiceId) {
                            console.error("ERRO: Não foi possível obter o ID da nova fatura após inserção.");
                            // Lançar um erro aqui pode ser apropriado se a fatura for crítica
                            // throw new Error("Falha ao obter ID da fatura.");
                        }
                    }
                }
            }
        } else if (!appointmentDetailsForEmail) { // Se não buscou detalhes no bloco 'Concluída'
             // Busca detalhes básicos APENAS para notificação de status (se não for 'Concluída')
             const [appointmentDetails] = await conn.query( "SELECT professional_id, patient_id, appointment_time FROM appointments WHERE id = ?", [id] );
             appointmentDetailsForEmail = appointmentDetails;
        }

        // <<< COMMIT AQUI >>>
        await conn.commit();

        // --- ENVIA A RESPOSTA DE SUCESSO IMEDIATAMENTE APÓS O COMMIT ---
        res.json({ message: 'Status atualizado com sucesso!' + (newInvoiceId ? ' Fatura gerada.' : '') });
        // O frontend receberá isso e fechará o modal / atualizará a lista.

        // --- TENTATIVA DE ENVIO DE NOTIFICAÇÕES E E-MAILS (APÓS A RESPOSTA) ---
        // Usamos um novo try...catch apenas para logar erros, sem afetar a resposta já enviada.
        try {
            // 1. Tenta enviar notificação e e-mail da FATURA (se foi criada nesta chamada)
            if (newInvoiceId && recipientUserId) {
                // Envia notificação via Socket.IO e salva no DB
                await createNotification(
                    req, recipientUserId, 'new_invoice',
                    `Nova cobrança de ${creatorNameForEmail} no valor de ${grossValueForEmail.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`,
                    `/${recipientType}/financeiro` // Link dinâmico
                );

                // Tenta enviar e-mail
                if (recipientEmail) {
                    await sendInvoiceNotificationEmail(
                        recipientEmail, recipientName, creatorNameForEmail, grossValueForEmail, dueDateForEmail, newInvoiceId,
                        `https://integrandoser.com.br/${recipientType}/financeiro` // Link dinâmico
                    );
                }
            }

            // 2. Tenta enviar notificações de ATUALIZAÇÃO DE STATUS (Socket + DB)
            const io = req.app.get('io');
            if (io) {
                 io.emit('appointmentStatusChanged'); // Notifica todos os clientes conectados
                 console.log(`[Socket Emit] Evento 'appointmentStatusChanged' emitido globalmente devido à atualização da consulta ${id}.`);
            } else {
                 console.warn(`AVISO [Consulta ${id}]: Instância do Socket.IO não encontrada. Não foi possível emitir 'appointmentStatusChanged'.`);
            }

            // Notifica especificamente o paciente via DB (e Socket se online)
            if (appointmentDetailsForEmail && appointmentDetailsForEmail.patient_id) { // Usa os detalhes guardados
                // Busca o user_id do paciente FORA da transação (ela já foi commitada)
                const [patientUser] = await pool.query("SELECT user_id FROM patients WHERE id = ?", [appointmentDetailsForEmail.patient_id]);
                if (patientUser && patientUser.user_id) {
                    const appointmentDate = new Date(appointmentDetailsForEmail.appointment_time).toLocaleDateString('pt-BR');
                    await createNotification(
                        req, patientUser.user_id, 'appointment_rescheduled', // re-usando tipo
                        `O status da sua consulta de ${appointmentDate} foi atualizado para: ${status}.`,
                        '/paciente/agenda'
                    );
                }
            }
        } catch (postCommitError) { // Captura qualquer erro ocorrido APÓS o commit e o envio da resposta
            // Apenas loga o erro no servidor, pois a operação principal foi bem-sucedida.
            console.error(`ERRO PÓS-COMMIT [Consulta ${id}]: Falha no envio de notificação/email após sucesso no DB:`, postCommitError);
        }

    } catch (error) { // Captura erros CRÍTICOS ocorridos ANTES do commit (DB, permissão)
        if (conn) await conn.rollback(); // Garante rollback se o erro foi antes do commit
        console.error(`Erro CRÍTICO ao atualizar status da consulta ${id} para ${status} (antes do commit):`, error);
        // Garante que uma resposta de erro seja enviada APENAS se o commit falhar E a resposta ainda não foi enviada
        if (!res.headersSent) {
             res.status(500).json({ message: 'Erro crítico ao processar a solicitação no banco de dados.' });
        } else {
             // Loga um alerta se o erro ocorreu depois que a resposta já foi enviada (muito raro)
             console.error(`[ALERTA] Erro DB detectado (antes do commit falhar?), mas a resposta de sucesso JÁ FOI ENVIADA para o cliente para a consulta ${id}.`);
        }
    } finally {
        if (conn) conn.release(); // Libera a conexão com o banco
    }
});



// ========== Profissional Habilitado ============

// ROTA ADAPTADA: Busca de usuários para o modal do profissional
router.get('/users-for-professional-agenda', protect, isProfissional, async (req, res) => {
    const { userId } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();
        
        // 1. Obter o ID do perfil profissional
        const [profProfile] = await conn.query("SELECT id FROM professionals WHERE user_id = ?", [userId]);
        if (!profProfile) {
            return res.status(404).json({ message: 'Perfil profissional não encontrado.' });
        }
        const professionalId = profProfile.id;

        // 2. Buscar pacientes associados a este profissional
        const patientsQuery = `
            SELECT DISTINCT p.id, p.nome 
            FROM patients p
            LEFT JOIN appointments a ON p.id = a.patient_id
            WHERE a.professional_id = ? OR p.created_by_professional_id = ?
            ORDER BY p.nome ASC;
        `;
        const patientsRows = await conn.query(patientsQuery, [professionalId, professionalId]);
        
        // 3. Buscar empresas vinculadas a esses pacientes
        const companiesRows = await conn.query(`
            SELECT DISTINCT c.id, c.nome_empresa 
            FROM companies c
            JOIN patients p ON c.id = p.company_id
            WHERE p.id IN (?)`, 
            [patientsRows.map(p => p.id)]
        );

        res.json({
            // O profissional é o próprio usuário logado
            professionals: [{id: professionalId, nome: 'Eu mesmo'}],
            patients: serializeBigInts(patientsRows),
            companies: serializeBigInts(companiesRows),
        });
    } catch (error) {
        console.error("Erro ao buscar dados para agenda do profissional:", error);
        res.status(500).json({ message: 'Erro ao buscar dados para agenda.' });
    } finally {
        if (conn) conn.release();
    }
});


// Rota para o PROFISSIONAL HABILITADO criar um ou mais agendamentos
router.post('/professional/appointments', protect, isProfissional, async (req, res) => {
    const { professional_id, patient_id, company_id, session_value, 
        frequency, appointment_times, is_package, 
        discount_percentage, total_value } = req.body;
    const { userId } = req.user;

    if (!professional_id || !patient_id || !appointment_times || !Array.isArray(appointment_times) || appointment_times.length === 0) {
        return res.status(400).json({ message: 'Profissional, paciente e pelo menos uma data são obrigatórios.' });
    }

    let conn;
    let newPackageInvoiceId = null; // Mova a declaração para fora do try para usar no log de erro
    let appointmentsCreatedCount = 0;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();

        const [profProfile] = await conn.query("SELECT id, nome, level FROM professionals WHERE user_id = ? AND id = ?", [userId, professional_id]);
        if (!profProfile || profProfile.level !== 'Profissional Habilitado') {
            await conn.rollback();
            return res.status(403).json({ message: 'Ação não autorizada. Você não tem permissão para criar agendamentos.' });
        }
        const professionalName = profProfile.nome;

        if (company_id) {
            await conn.query('UPDATE patients SET company_id = ? WHERE id = ?', [company_id, patient_id]);
        }
        await conn.query('INSERT IGNORE INTO professional_assignments (professional_id, patient_id) VALUES (?, ?)', [professional_id, patient_id]);
        
        const appointmentsToCreate = [];
        const initialDate = new Date(appointment_times[0]);

        // ==========================================================
        // --- LÓGICA DE CRIAÇÃO DE PACOTE E FATURA ---

        let newPackageInvoiceId = null;
        let newStatus = 'Agendada';
        let recipientUserId = null;
        let recipientName = '';
        let recipientEmail = '';
        let recipientType = '';

        if (is_package && total_value > 0) {
            newStatus = 'Aguardando Pagamento';

            // 1. Identifica o pagador (paciente ou empresa)
            const [patientDetails] = await conn.query("SELECT user_id, company_id, nome FROM patients WHERE id = ?", [patient_id]);
            if (patientDetails) {
                if (patientDetails.company_id) {
                    const [companyDetails] = await conn.query("SELECT u.id as user_id, c.nome_empresa as name, u.email FROM companies c JOIN users u ON c.user_id = u.id WHERE c.id = ?", [patientDetails.company_id]);
                    if (companyDetails) {
                        recipientUserId = companyDetails.user_id;
                        recipientName = companyDetails.name;
                        recipientEmail = companyDetails.email;
                        recipientType = 'empresa';
                    }
                }
                if (!recipientUserId) { // Se não tiver empresa, cobra o paciente
                    const [userPatientDetails] = await conn.query("SELECT u.id as user_id, p.nome as name, u.email FROM patients p JOIN users u ON p.user_id = u.id WHERE p.id = ?", [patient_id]);
                    if (userPatientDetails) {
                        recipientUserId = userPatientDetails.user_id;
                        recipientName = userPatientDetails.name;
                        recipientEmail = userPatientDetails.email;
                        recipientType = 'paciente';
                    }
                }
            }

            // 2. Se encontrou um pagador, cria a fatura
            if (recipientUserId) {
                const dueDate = new Date();
                dueDate.setDate(dueDate.getDate() + 7); // Vencimento em 7 dias
                const description = `Pacote de ${appointment_times.length} sessões com ${professionalName}. Desconto de ${discount_percentage}%.`;

                const invoiceResult = await conn.query(
                    'INSERT INTO invoices (user_id, creator_user_id, amount, due_date, description, status) VALUES (?, ?, ?, ?, ?, ?)',
                    [recipientUserId, userId, total_value, dueDate, description, 'pending']
                );
                newPackageInvoiceId = invoiceResult.insertId; // Vincula os agendamentos a esta fatura
                
            } else {
                await conn.rollback();
                return res.status(400).json({ message: 'Não foi possível identificar um destinatário para a fatura do pacote.' });
                //throw new Error('Não foi possível identificar um destinatário para a fatura do pacote.');
            }
        }

        // ==========================================================
        // --- EVENTO UNICO ---

        if (frequency === 'Evento Único' || is_package) { // Pacotes são sempre 'Evento Único'
            appointment_times.forEach(time => {
                appointmentsToCreate.push({
                    series_id: null,
                    professional_id: professional_id,
                    patient_id: patient_id,
                    appointment_time: time,
                    session_value: session_value || null,
                    status: newStatus,
                    package_invoice_id: newPackageInvoiceId
                });
            });
        } else { // Lógica de recorrência (não é pacote)
             const seriesResult = await conn.query('INSERT INTO appointment_series (professional_id, patient_id, start_date, frequency, session_value) VALUES (?, ?, ?, ?, ?)', [professional_id, patient_id, initialDate, frequency, session_value]);
             const newSeriesId = seriesResult.insertId;
             let currentDate = initialDate;
             const endDate = new Date();
             endDate.setMonth(initialDate.getMonth() + 3);
             const increment = (frequency === 'Semanalmente') ? 7 : 14;
             while (currentDate <= endDate) {
                 appointmentsToCreate.push({ 
                     series_id: newSeriesId, professional_id, patient_id, 
                     appointment_time: new Date(currentDate), 
                     session_value: session_value || null,
                     status: newStatus, // 'Agendada'
                     package_invoice_id: null
                 });
                 currentDate.setDate(currentDate.getDate() + increment);
             }
        }
        
        for (const app of appointmentsToCreate) {
            await conn.query(
                'INSERT INTO appointments (series_id, professional_id, patient_id, appointment_time, session_value, status, package_invoice_id) VALUES (?, ?, ?, ?, ?, ?, ?)', 
                [app.series_id, app.professional_id, app.patient_id, app.appointment_time, app.session_value, app.status, app.package_invoice_id]
            );
        }

        appointmentsCreatedCount = appointmentsToCreate.length;
        
        await conn.commit();

        // Se for pacote, notifica sobre a fatura
        if (is_package && recipientUserId) {
            try { // Bloco try/catch para notificação + e-mail
                await createNotification(
                    req,
                    recipientUserId,
                    'new_invoice',
                    `Nova cobrança de pacote (${professionalName}) no valor de ${total_value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`,
                    `/${recipientType}/financeiro`
                );

                if (recipientEmail) {
                    await sendInvoiceNotificationEmail(
                        recipientEmail,
                        recipientName,
                        professionalName,
                        total_value,
                        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Due date
                        newPackageInvoiceId,
                        `https://integrandoser.com.br/${recipientType}/financeiro`
                    );
                }
            } catch (emailOrNotificationError) {
                console.error(`AVISO: Pacote ${newPackageInvoiceId} criado, mas notificação/email falhou:`, emailOrNotificationError);
                // NÃO retorna erro 500 aqui, apenas loga o aviso,
                // pois a criação do pacote no DB foi bem-sucedida.
            }
        }

        const [patientUser] = await conn.query("SELECT user_id, nome, email FROM patients p JOIN users u ON p.user_id = u.id WHERE p.id = ?", [patient_id]);
        if (patientUser && patientUser.user_id) {
            const appointmentDate = new Date(appointment_times[0]).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
            const message = is_package 
                ? `Seu profissional (${professionalName}) pré-agendou ${appointment_times.length} sessões. O agendamento será confirmado após o pagamento da fatura.`
                : `Seu profissional (${professionalName}) agendou uma nova consulta para você em ${appointmentDate}.`;
            
            await createNotification(
                req, 
                patientUser.user_id, 
                'new_appointment', 
                message,
                '/paciente/agenda'
            );

            // Envia e-mail de agendamento (apenas se não for pacote, para evitar e-mails duplicados)
            if (!is_package) {
                try {
                    await sendSchedulingEmail(
                        patientUser.email,
                        patientUser.nome,
                        professionalName,
                        new Date(appointment_times[0])
                    );
                } catch (emailError) {
                    console.error("AVISO: Agendamento criado, mas e-mail de confirmação falhou.", emailError);
                }
            }
        }
        
        res.status(201).json({ message: `${appointmentsToCreate.length} agendamento(s) criado(s) com sucesso!` });

    } catch (error) {
        if (conn) await conn.rollback();
        // --- ENHANCED LOGGING ---
        console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
        console.error("!!! ERROR in POST /professional/appointments !!!");
        console.error("Timestamp:", new Date().toISOString());
        console.error("User ID:", userId); // Log which user triggered the error
        console.error("Request Body Snippet:", JSON.stringify(req.body).substring(0, 500)); // Log part of the incoming data
        console.error("Error Object:", error); // Log the full error object (stack trace included!)
        console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
        // --- END ENHANCED LOGGING ---
        console.error("Erro ao criar agendamento pelo profissional:", error);
        res.status(500).json({ message: 'Erro interno no servidor ao processar o agendamento.' });
    } finally {
        if (conn) conn.release();
    }
});


router.put('/professional/appointments/:id', protect, isProfissional, async (req, res) => {
    const { id } = req.params;
    const { patient_id, appointment_time, session_value } = req.body;
    const { userId } = req.user;

    // Validação básica dos dados recebidos
    if (!patient_id || !appointment_time) {
        return res.status(400).json({ message: 'Paciente e data/hora do agendamento são obrigatórios.' });
    }

    let conn;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();

        // 1. Obter o ID do perfil do profissional logado
        const [profProfile] = await conn.query("SELECT id FROM professionals WHERE user_id = ?", [userId]);
        if (!profProfile) {
            await conn.rollback();
            return res.status(403).json({ message: 'Perfil profissional não encontrado.' });
        }
        const professionalId = profProfile.id;

        // 2. Query de atualização direta e robusta (sem construção dinâmica)
        const query = `
            UPDATE appointments SET 
                patient_id = ?, 
                appointment_time = ?, 
                session_value = ? 
            WHERE id = ? AND professional_id = ?
        `;
        
        const result = await conn.query(query, [
            patient_id,
            appointment_time,
            session_value || null, // Garante que o valor seja nulo se não for fornecido
            id,
            professionalId
        ]);

        // 3. Verifica se a atualização foi bem-sucedida
        if (result.affectedRows === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Agendamento não encontrado ou você não tem permissão para editá-lo.' });
        }
        
        await conn.commit();
        
        // 4. Lógica de notificação para o paciente (opcional, mas recomendado)
        try {
            const [patientUser] = await conn.query("SELECT user_id FROM patients WHERE id = ?", [patient_id]);
            if (patientUser && patientUser.user_id) {
                const appointmentDate = new Date(appointment_time).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
                await createNotification(
                    req,
                    patientUser.user_id,
                    'appointment_rescheduled',
                    `Seu agendamento foi alterado para ${appointmentDate} pelo seu profissional.`,
                    '/paciente/agenda'
                );
            }
        } catch (notificationError) {
            console.error("AVISO: Agendamento atualizado, mas a notificação falhou:", notificationError);
        }
        
        res.json({ message: 'Agendamento atualizado com sucesso!' });
    } catch (error) {
        if (conn) await conn.rollback();
        console.error("Erro ao atualizar agendamento:", error);
        res.status(500).json({ message: 'Erro interno ao atualizar o agendamento.' });
    } finally {
        if (conn) conn.release();
    }
});

// Rota para o PROFISSIONAL DELETAR um agendamento
router.delete('/professional/appointments/:id', protect, isProfissional, async (req, res) => {
    const { id } = req.params;
    const { userId } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();

        const [profProfile] = await conn.query("SELECT id FROM professionals WHERE user_id = ?", [userId]);
        if (!profProfile) return res.status(403).json({ message: 'Acesso negado.' });
        
        await conn.query('DELETE FROM appointments WHERE id = ? AND professional_id = ?', [id, profProfile.id]);
        
        res.json({ message: 'Agendamento removido com sucesso.' });
    } catch (error) {
        console.error("Erro ao remover agendamento:", error);
        res.status(500).json({ message: 'Erro ao remover agendamento.' });
    } finally {
        if (conn) conn.release();
    }
});

// ==========================================
// --- ROTAS DE COMPROMISSOS PESSOAIS ---
// ==========================================

// Criar Compromisso Pessoal
router.post('/personal-appointment', protect, async (req, res) => {
    const { title, description, start_time, end_time, color, status } = req.body;
    const { userId } = req.user;

    if (!title || !start_time || !end_time) {
        return res.status(400).json({ message: 'Título e horários são obrigatórios.' });
    }

    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query(
            `INSERT INTO personal_appointments (user_id, title, description, start_time, end_time, color, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [userId, title, description || '', new Date(start_time), new Date(end_time), color || '#3b82f6', status || 'Agendada']
        );
        res.status(201).json({ message: 'Compromisso pessoal criado com sucesso!' });
    } catch (error) {
        console.error("Erro ao criar compromisso pessoal:", error);
        res.status(500).json({ message: 'Erro ao salvar compromisso.' });
    } finally {
        if (conn) conn.release();
    }
});

// Atualizar Compromisso Pessoal
router.put('/personal-appointment/:id', protect, async (req, res) => {
    const { id } = req.params;
    const { title, description, start_time, end_time, color, status } = req.body;
    const { userId } = req.user;

    let conn;
    try {
        conn = await pool.getConnection();
        const result = await conn.query(
            `UPDATE personal_appointments 
             SET title = ?, description = ?, start_time = ?, end_time = ?, color = ?, status = ?
             WHERE id = ? AND user_id = ?`,
            [title, description, new Date(start_time), new Date(end_time), color, status, id, userId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Compromisso não encontrado ou permissão negada.' });
        }
        res.json({ message: 'Compromisso atualizado!' });
    } catch (error) {
        console.error("Erro ao atualizar compromisso pessoal:", error);
        res.status(500).json({ message: 'Erro ao atualizar.' });
    } finally {
        if (conn) conn.release();
    }
});

// Excluir Compromisso Pessoal
router.delete('/personal-appointment/:id', protect, async (req, res) => {
    const { id } = req.params;
    const { userId } = req.user;

    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query('DELETE FROM personal_appointments WHERE id = ? AND user_id = ?', [id, userId]);
        res.json({ message: 'Compromisso excluído.' });
    } catch (error) {
        console.error("Erro ao excluir compromisso:", error);
        res.status(500).json({ message: 'Erro ao excluir.' });
    } finally {
        if (conn) conn.release();
    }
});


module.exports = router;