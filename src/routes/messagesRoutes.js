// server/src/routes/messagesRoutes.js
const express = require('express');
const pool = require('../config/db.js');
const { protect } = require('../middleware/authMiddleware.js');
const upload = require('../middleware/uploadMiddleware.js');
const { createNotification, getRoleBasedUrlPrefix } = require('../services/notificationService.js');
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

// Rota para listar as conversas do usuário logado (com filtro de conversas apagadas)
router.get('/conversations', protect, async (req, res) => {
    const { userId } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();
        const query = `
            SELECT 
                u.id as participant_id,
                COALESCE(p.nome, prof.nome, c.nome_empresa, a.nome) as participant_name,
                COALESCE(p.imagem_url, prof.imagem_url, c.imagem_url, a.imagem_url) as participant_photo,
                m.content as last_message,
                m.created_at as last_message_time,
                -- ADICIONADO: Sub-query para contar mensagens não lidas de cada participante
                (SELECT COUNT(*) FROM messages WHERE recipient_id = ? AND sender_id = u.id AND is_read = 0) as unread_count
            FROM (
                SELECT 
                    IF(sender_id = ?, recipient_id, sender_id) as other_user_id,
                    MAX(id) as last_message_id
                FROM messages
                WHERE (sender_id = ? OR recipient_id = ?)
                GROUP BY IF(sender_id = ?, recipient_id, sender_id)
            ) AS conversations
            JOIN messages m ON m.id = conversations.last_message_id
            JOIN users u ON u.id = conversations.other_user_id
            LEFT JOIN deleted_conversations dc ON dc.user_id = ? AND dc.participant_id = conversations.other_user_id
            LEFT JOIN patients p ON u.id = p.user_id
            LEFT JOIN professionals prof ON u.id = prof.user_id
            LEFT JOIN companies c ON u.id = c.user_id
            LEFT JOIN administrators a ON u.id = a.user_id
            WHERE conversations.other_user_id != ? AND dc.user_id IS NULL
            ORDER BY m.created_at DESC;
        `;
        // ATUALIZADO: O userId agora é usado 7 vezes
        const conversationsResult = await conn.query(query, [userId, userId, userId, userId, userId, userId, userId]);
        res.json(serializeBigInts(conversationsResult));
    } catch (error) {
        console.error("Erro ao buscar conversas:", error);
        res.status(500).json({ message: 'Erro ao buscar conversas.' });
    } finally {
        if (conn) conn.release();
    }
});

// Rota para buscar as mensagens de uma conversa específica
// Rota para buscar as mensagens de uma conversa específica (CORRIGIDA)
router.get('/:participantId', protect, async (req, res) => {
    const { userId } = req.user;
    const { participantId } = req.params;
    let conn;
    try {
        conn = await pool.getConnection();

        // 1. ANTES de buscar as mensagens, verificamos se o usuário atual apagou a conversa.
        const [deletedInfo] = await conn.query(
            'SELECT user_id FROM deleted_conversations WHERE user_id = ? AND participant_id = ?',
            [userId, participantId]
        );

        // 2. Se a conversa foi apagada por este usuário, retornamos uma lista vazia.
        if (deletedInfo) {
            return res.json([]); // Retorna um array vazio, mostrando um chat limpo.
        }

        // 3. Se não foi apagada, busca o histórico completo (lógica original).
        const query = `
            SELECT 
                m.id, 
                m.sender_id, 
                m.content, 
                m.created_at, 
                m.is_read,
                (SELECT JSON_ARRAYAGG(JSON_OBJECT('user_id', r.user_id, 'emoji', r.emoji)) 
                 FROM message_reactions r WHERE r.message_id = m.id) as reactions,
                (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', a.id, 'file_url', a.file_url, 'file_type', a.file_type))
                 FROM message_attachments a WHERE a.message_id = m.id) as attachments
            FROM messages m
            WHERE (m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?)
            ORDER BY m.created_at ASC;
        `;
        const messages = await conn.query(query, [userId, participantId, participantId, userId]);
        
        // Marca as mensagens como lidas
        await conn.query('UPDATE messages SET is_read = 1 WHERE sender_id = ? AND recipient_id = ?', [participantId, userId]);
        
        res.json(serializeBigInts(messages));
    } catch (error) {
        console.error("Erro ao buscar mensagens:", error);
        res.status(500).json({ message: 'Erro ao buscar mensagens.' });
    } finally {
        if (conn) conn.release();
    }
});


// Rota para buscar usuários para iniciar uma nova conversa (respeitando as regras)
router.get('/search-users/:searchTerm', protect, async (req, res) => {
    const { searchTerm } = req.params;
    let conn;
    try {
        conn = await pool.getConnection();
        const query = `
            SELECT u.id, COALESCE(p.nome, prof.nome, c.nome_empresa, a.nome) as name, 
            -- CORREÇÃO APLICADA AQUI: Busca a imagem na tabela de perfil correta
            COALESCE(p.imagem_url, prof.imagem_url, c.imagem_url, a.imagem_url) as imagem_url, 
            r.name as role
            FROM users u
            JOIN roles r ON u.role_id = r.id
            LEFT JOIN patients p ON u.id = p.user_id
            LEFT JOIN professionals prof ON u.id = prof.user_id
            LEFT JOIN companies c ON u.id = c.user_id
            LEFT JOIN administrators a ON u.id = a.user_id
            WHERE COALESCE(p.nome, prof.nome, c.nome_empresa, a.nome) LIKE ?
        `;
        const users = await conn.query(query, [`%${searchTerm}%`]);
        res.json(serializeBigInts(users));
    } catch (error) {
        console.error("Erro ao buscar usuários:", error);
        res.status(500).json({ message: 'Erro ao buscar usuários.' });
    } finally {
        if (conn) conn.release();
    }
});

// Rota para enviar uma nova mensagem
router.post('/', protect, upload.array('attachments'), async (req, res) => {
    const sender_id = req.user.userId;
    const senderRole = req.user.role;
    const { recipient_id, content } = req.body;

    if (!recipient_id || (!content && (!req.files || req.files.length === 0))) {
        return res.status(400).json({ message: "Destinatário e conteúdo ou anexo são obrigatórios." });
    }

    let conn;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();

        // --- LÓGICA DE PERMISSÃO (REESCRITA) ---
        let hasPermission = false;
        
        // 1. Verificar se o destinatário existe
        const [recipientUser] = await conn.query('SELECT r.name as role FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?', [recipient_id]);
        if (!recipientUser) {
            await conn.rollback();
            return res.status(404).json({ message: "Destinatário não encontrado." });
        }
        const recipientRole = recipientUser.role;

        // Regra 1: ADMs podem falar com todos, e todos podem falar com ADMs
        if (senderRole === 'ADM' || recipientRole === 'ADM') {
            hasPermission = true;
        } 
        // Regra 2: Profissionais podem falar com outros Profissionais
        else if (senderRole === 'PROFISSIONAL' && recipientRole === 'PROFISSIONAL') {
            hasPermission = true;
        } 
        // Regra 3: Paciente <-> Profissional (requer vínculo)
        else if ((senderRole === 'PROFISSIONAL' && recipientRole === 'PACIENTE') || (senderRole === 'PACIENTE' && recipientRole === 'PROFISSIONAL')) {
            const professional_user_id = (senderRole === 'PROFISSIONAL') ? sender_id : recipient_id;
            const patient_user_id = (senderRole === 'PACIENTE') ? sender_id : recipient_id;
            
            const [checkRelation] = await conn.query(`
                SELECT 1
                FROM professionals prof
                JOIN patients pat ON prof.user_id = ? AND pat.user_id = ?
                LEFT JOIN professional_assignments pa ON pa.professional_id = prof.id AND pa.patient_id = pat.id
                LEFT JOIN appointments app ON app.professional_id = prof.id AND app.patient_id = pat.id
                WHERE pa.id IS NOT NULL OR app.id IS NOT NULL OR pat.created_by_professional_id = prof.id
                LIMIT 1;
            `, [professional_user_id, patient_user_id]);

            if (checkRelation) hasPermission = true;
        }
        // Regra 4: Paciente <-> Empresa (requer vínculo)
        else if ((senderRole === 'EMPRESA' && recipientRole === 'PACIENTE') || (senderRole === 'PACIENTE' && recipientRole === 'EMPRESA')) {
            const empresa_user_id = (senderRole === 'EMPRESA') ? sender_id : recipient_id;
            const patient_user_id = (senderRole === 'PACIENTE') ? sender_id : recipient_id;

            const [checkRelation] = await conn.query(`
                SELECT 1
                FROM companies c
                JOIN patients p ON c.id = p.company_id
                WHERE c.user_id = ? AND p.user_id = ?
                LIMIT 1;
            `, [empresa_user_id, patient_user_id]);

            if (checkRelation) hasPermission = true;
        }
        // Regra 5: Empresa <-> Profissional (requer vínculo via paciente)
        else if ((senderRole === 'EMPRESA' && recipientRole === 'PROFISSIONAL') || (senderRole === 'PROFISSIONAL' && recipientRole === 'EMPRESA')) {
            const empresa_user_id = (senderRole === 'EMPRESA') ? sender_id : recipient_id;
            const professional_user_id = (senderRole === 'PROFISSIONAL') ? sender_id : recipient_id;

            const [checkRelation] = await conn.query(`
                SELECT 1
                FROM companies c
                JOIN patients p ON c.id = p.company_id
                LEFT JOIN professional_assignments pa ON pa.patient_id = p.id
                LEFT JOIN appointments a ON a.patient_id = p.id
                JOIN professionals prof ON (pa.professional_id = prof.id OR a.professional_id = prof.id OR p.created_by_professional_id = prof.id)
                WHERE c.user_id = ? AND prof.user_id = ?
                LIMIT 1;
            `, [empresa_user_id, professional_user_id]);

            if (checkRelation) hasPermission = true;
        }
        // --- FIM DA LÓGICA DE PERMISSÃO ---
        
        if (!hasPermission) {
            await conn.rollback();
            return res.status(403).json({ message: "Você não tem permissão para enviar uma mensagem para este usuário." });
        }
        
        // --- INSERÇÃO DA MENSAGEM ---
        const messageResult = await conn.query(
            'INSERT INTO messages (sender_id, recipient_id, content) VALUES (?, ?, ?)',
            [sender_id, recipient_id, content || '']
        );
        
        const newMessageId = Array.isArray(messageResult) && messageResult[0] ? messageResult[0].insertId : messageResult.insertId;
        if (!newMessageId) throw new Error("Não foi possível obter o ID da nova mensagem.");

        // Salva anexos, se houver
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                // Verifica se o upload para GCS deu certo antes de salvar no DB
                if (file && file.gcsUrl) { // <<< Verifica gcsUrl
                    const file_url = file.gcsUrl; // <<< Usa gcsUrl
                    const file_type = file.mimetype;
                    await conn.query(
                        'INSERT INTO message_attachments (message_id, file_url, file_type) VALUES (?, ?, ?)',
                        [newMessageId, file_url, file_type] // Salva gcsUrl
                    );
                } else {
                    console.warn(`[MESSAGE SEND] Anexo ${file.originalname} recebido, mas URL GCS não encontrada. Anexo ignorado.`);
                }
            }
        }
        
        // --- LÓGICA DE NOTIFICAÇÃO ---
        // 2. Obter o nome do remetente para uma notificação mais clara
        const [senderProfile] = await conn.query(`
            SELECT COALESCE(p.nome, prof.nome, c.nome_empresa, a.nome) as name
            FROM users u
            LEFT JOIN patients p ON u.id = p.user_id
            LEFT JOIN professionals prof ON u.id = prof.user_id
            LEFT JOIN companies c ON u.id = c.user_id
            LEFT JOIN administrators a ON u.id = a.user_id
            WHERE u.id = ?
        `, [sender_id]);
        const senderName = senderProfile ? senderProfile.name : 'Um usuário';

        // 3. Chamar a função createNotification (que agora funciona corretamente)
        await createNotification(
            req,
            recipient_id,
            'new_message',
            `Nova mensagem de ${senderName}.` // Mensagem mais específica
        );

        // --- FINALIZAÇÃO E RESPOSTA ---
        await conn.commit();

        // Restaura a conversa para ambos os usuários se ela foi previamente "apagada".
        await conn.query(
            'DELETE FROM deleted_conversations WHERE (user_id = ? AND participant_id = ?) OR (user_id = ? AND participant_id = ?)',
            [sender_id, recipient_id, recipient_id, sender_id]
        );

        const [newlyCreatedMessage] = await conn.query(
            `SELECT m.id, m.sender_id, m.content, m.created_at, m.is_read,
                    (SELECT JSON_ARRAYAGG(JSON_OBJECT('user_id', r.user_id, 'emoji', r.emoji)) 
                     FROM message_reactions r WHERE r.message_id = m.id) as reactions,
                    (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', a.id, 'file_url', a.file_url, 'file_type', a.file_type))
                     FROM message_attachments a WHERE a.message_id = m.id) as attachments
             FROM messages m WHERE m.id = ?`, 
            [newMessageId]
        );

        const io = req.app.get('io');
        const getUserSocket = req.app.get('getUserSocket');
        const recipientSocketId = getUserSocket(recipient_id);

        if (recipientSocketId) {
            io.to(recipientSocketId).emit('newMessage', serializeBigInts(newlyCreatedMessage));
        }

        res.status(201).json(serializeBigInts(newlyCreatedMessage));

    } catch (error) {
        if (conn) await conn.rollback();
        console.error("Erro ao enviar mensagem:", error);
        res.status(500).json({ message: 'Erro ao enviar mensagem.' });
    } finally {
        if (conn) conn.release();
    }
});



// Editar uma mensagem
router.put('/:messageId', protect, async (req, res) => {
    const { messageId } = req.params;
    const { content } = req.body;
    const { userId } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();
        // Verifica se o usuário é o autor e se a mensagem tem menos de 1 hora
        const [message] = await conn.query(
            'SELECT * FROM messages WHERE id = ? AND sender_id = ? AND created_at > NOW() - INTERVAL 1 HOUR',
            [messageId, userId]
        );
        if (!message) {
            return res.status(403).json({ message: 'Você não pode editar esta mensagem.' });
        }
        await conn.query('UPDATE messages SET content = ? WHERE id = ?', [content, messageId]);
        res.json({ message: 'Mensagem atualizada com sucesso.' });
    } catch (error) {
        console.error("Erro ao editar mensagem:", error);
        res.status(500).json({ message: 'Erro ao editar mensagem.' });
    } finally {
        if (conn) conn.release();
    }
});


// Apagar uma mensagem
router.delete('/:messageId', protect, async (req, res) => {
    const { messageId } = req.params;
    const { userId } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();
        // Mesma verificação da edição
        const [message] = await conn.query(
            'SELECT * FROM messages WHERE id = ? AND sender_id = ? AND created_at > NOW() - INTERVAL 1 HOUR',
            [messageId, userId]
        );
        if (!message) {
            return res.status(403).json({ message: 'Você não pode apagar esta mensagem.' });
        }
        await conn.query('DELETE FROM messages WHERE id = ?', [messageId]);
        res.json({ message: 'Mensagem apagada com sucesso.' });
    } catch (error) {
        console.error("Erro ao apagar mensagem:", error);
        res.status(500).json({ message: 'Erro ao apagar mensagem.' });
    } finally {
        if (conn) conn.release();
    }
});


//  Rota para buscar sugestões de usuários para iniciar conversa
router.get('/conversations/suggestions', protect, async (req, res) => {
    const { userId, role } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();
        let query;
        let queryParams = [userId];

        // Regra 1: ADM pode conversar com qualquer um (exceto ele mesmo)
        if (role === 'ADM') {
            query = `
                SELECT u.id, COALESCE(p.nome, prof.nome, c.nome_empresa, a.nome) as name, 
                COALESCE(p.imagem_url, prof.imagem_url, c.imagem_url, a.imagem_url) as imagem_url, 
                r.name as role
                FROM users u
                JOIN roles r ON u.role_id = r.id
                LEFT JOIN patients p ON u.id = p.user_id
                LEFT JOIN professionals prof ON u.id = prof.user_id
                LEFT JOIN companies c ON u.id = c.user_id
                LEFT JOIN administrators a ON u.id = a.user_id
                WHERE u.id != ?
                ORDER BY u.id DESC LIMIT 6
            `;
        } 
        // Regra 2: PACIENTE só pode conversar com ADMs, seus PROFISSIONAIS e sua EMPRESA
        else if (role === 'PACIENTE') {
            queryParams.push(userId); // Adiciona o segundo userId para a query
            queryParams.push(userId); // Adiciona o terceiro userId para a query
            query = `
                (
                    -- 1. Seus Profissionais (vínculo por pa, app ou created_by)
                    SELECT DISTINCT u.id, prof.nome as name, prof.imagem_url, 'PROFISSIONAL' as role
                    FROM patients pat
                    LEFT JOIN professional_assignments pa ON pa.patient_id = pat.id
                    LEFT JOIN appointments a ON a.patient_id = pat.id
                    JOIN professionals prof ON pa.professional_id = prof.id OR a.professional_id = prof.id OR pat.created_by_professional_id = prof.id
                    JOIN users u ON prof.user_id = u.id
                    WHERE pat.user_id = ?
                )
                UNION
                (
                    -- 2. Sua Empresa (se houver)
                    SELECT u.id, c.nome_empresa as name, c.imagem_url, 'EMPRESA' as role
                    FROM patients p
                    JOIN companies c ON p.company_id = c.id
                    JOIN users u ON c.user_id = u.id
                    WHERE p.user_id = ? AND p.company_id IS NOT NULL
                )
                UNION
                (
                    -- 3. ADMs
                    SELECT u.id, adm.nome as name, adm.imagem_url, 'ADM' as role
                    FROM users u 
                    JOIN roles r ON u.role_id = r.id 
                    JOIN administrators adm ON u.id = adm.user_id
                    WHERE r.name = 'ADM' AND u.id != ?
                )
            `;
        }
        // Regra 3: PROFISSIONAL pode conversar com ADMs, seus PACIENTES, EMPRESAS dos seus pacientes e outros PRO fissionais
        else if (role === 'PROFISSIONAL') {
            const profProfileRows = await conn.query('SELECT id FROM professionals WHERE user_id = ?', [userId]);
            if (!profProfileRows || profProfileRows.length === 0) return res.json([]);
            
            const professionalId = profProfileRows[0].id;
            
            queryParams = [
                professionalId, professionalId, professionalId, // Para pacientes
                professionalId, professionalId, professionalId, // Para empresas
                userId // Para excluir a si mesmo da lista de profissionais
            ];

            query = `
                (
                    -- 1. ADMs
                    SELECT u.id, adm.nome as name, adm.imagem_url, 'ADM' as role
                    FROM users u JOIN roles r ON u.role_id = r.id JOIN administrators adm ON u.id = adm.user_id
                    WHERE r.name = 'ADM'
                )
                UNION
                (
                    -- 2. Seus Pacientes
                    SELECT DISTINCT u.id, p.nome as name, p.imagem_url, 'PACIENTE' as role
                    FROM patients p
                    JOIN users u ON p.user_id = u.id
                    LEFT JOIN professional_assignments pa ON p.id = pa.patient_id
                    LEFT JOIN appointments a ON p.id = a.patient_id
                    WHERE pa.professional_id = ? OR a.professional_id = ? OR p.created_by_professional_id = ?
                )
                UNION
                (
                    -- 3. Empresas dos seus Pacientes
                    SELECT DISTINCT u.id, c.nome_empresa as name, c.imagem_url, 'EMPRESA' as role
                    FROM companies c
                    JOIN users u ON c.user_id = u.id
                    JOIN patients p ON c.id = p.company_id
                    LEFT JOIN professional_assignments pa ON p.id = pa.patient_id
                    LEFT JOIN appointments a ON p.id = a.patient_id
                    WHERE (pa.professional_id = ? OR a.professional_id = ? OR p.created_by_professional_id = ?) AND p.company_id IS NOT NULL
                )
                UNION
                (
                    -- 4. Outros Profissionais (excluindo a si mesmo)
                    SELECT u.id, prof.nome as name, prof.imagem_url, 'PROFISSIONAL' as role
                    FROM users u
                    JOIN roles r ON u.role_id = r.id
                    JOIN professionals prof ON u.id = prof.user_id
                    WHERE r.name = 'PROFISSIONAL' AND u.id != ?
                )
            `;
        } 
        // Regra 4: EMPRESA pode conversar com ADMs, seus PACIENTES (colaboradores) e PROFISSIONAIS dos seus pacientes
        else if (role === 'EMPRESA') {
            queryParams.push(userId); // Adiciona o segundo userId para a query
            queryParams.push(userId); // Adiciona o terceiro userId para a query
            query = `
                (
                    -- 1. Seus Pacientes (Colaboradores)
                    SELECT u.id, p.nome as name, p.imagem_url, 'PACIENTE' as role
                    FROM companies c
                    JOIN patients p ON c.id = p.company_id
                    JOIN users u ON p.user_id = u.id
                    WHERE c.user_id = ?
                )
                UNION
                (
                    -- 2. ADMs
                    SELECT u.id, adm.nome as name, adm.imagem_url, 'ADM' as role
                    FROM users u JOIN roles r ON u.role_id = r.id JOIN administrators adm ON u.id = adm.user_id
                    WHERE r.name = 'ADM' AND u.id != ?
                )
                UNION
                (
                    -- 3. Profissionais dos seus Pacientes
                    SELECT DISTINCT u.id, prof.nome as name, prof.imagem_url, 'PROFISSIONAL' as role
                    FROM companies c
                    JOIN patients p ON c.id = p.company_id
                    LEFT JOIN professional_assignments pa ON pa.patient_id = p.id
                    LEFT JOIN appointments a ON a.patient_id = p.id
                    JOIN professionals prof ON pa.professional_id = prof.id OR a.professional_id = prof.id OR p.created_by_professional_id = prof.id
                    JOIN users u ON prof.user_id = u.id
                    WHERE c.user_id = ?
                )
            `; 
        } else {
            // Outras roles (não devem existir)
            return res.json([]);
        }

        const users = await conn.query(query, queryParams);
        res.json(serializeBigInts(users));

    } catch (error) {
        console.error("Erro ao buscar sugestões:", error);
        res.status(500).json({ message: 'Erro ao buscar sugestões.' });
    } finally {
        if (conn) conn.release();
    }
});


// Rota para adicionar/remover uma reação
router.post('/:messageId/react', protect, async (req, res) => {
    const { messageId } = req.params;
    const { emoji } = req.body;
    const { userId } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query(
            'INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE emoji = VALUES(emoji)',
            [messageId, userId, emoji]
        );
        
        // NOVO: Emitir evento de socket para todos os clientes relevantes
        const io = req.app.get('io');
        const [message] = await conn.query('SELECT sender_id, recipient_id FROM messages WHERE id = ?', [messageId]);
        
        if (message) {
            const getUserSocket = req.app.get('getUserSocket');
            const senderSocket = getUserSocket(message.sender_id);
            const recipientSocket = getUserSocket(message.recipient_id);
            
            const reactionData = { messageId, userId, emoji };

            // Emite para o remetente e destinatário da mensagem
            if (senderSocket) io.to(senderSocket).emit('messageReaction', reactionData);
            if (recipientSocket) io.to(recipientSocket).emit('messageReaction', reactionData);
        }
        
        res.status(201).json({ message: 'Reação salva com sucesso.' });
    } catch (error) {
        console.error("Erro ao salvar reação:", error);
        res.status(500).json({ message: 'Erro ao salvar reação.' });
    } finally {
        if (conn) conn.release();
    }
});


// Rota para 'apagar' uma conversa (soft delete)
router.delete('/conversations/:participantId', protect, async (req, res) => {
    const { userId } = req.user;
    const { participantId } = req.params;
    let conn;
    try {
        conn = await pool.getConnection();
        // Em vez de deletar as mensagens, registramos que este usuário 'apagou' a conversa.
        // A cláusula ON DUPLICATE KEY UPDATE evita erros caso o usuário apague a mesma conversa duas vezes.
        const query = 'INSERT INTO deleted_conversations (user_id, participant_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = user_id';
        await conn.query(query, [userId, participantId]);
        
        res.json({ message: 'Conversa removida com sucesso.' });
    } catch (error) {
        console.error("Erro ao remover conversa:", error);
        res.status(500).json({ message: 'Erro ao remover a conversa.' });
    } finally {
        if (conn) conn.release();
    }
});


module.exports = router;