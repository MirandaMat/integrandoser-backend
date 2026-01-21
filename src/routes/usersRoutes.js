const express = require('express');
const pool = require('../config/db.js');
const bcrypt = require('bcryptjs');
const { protect, isAdmin, isProfissional, isPaciente } = require('../middleware/authMiddleware.js');
const upload = require('../middleware/uploadMiddleware.js');
const { sendWelcomeEmail } = require('../config/mailer.js');
const { createNotification } = require('../services/notificationService.js');
const router = express.Router();

// Função auxiliar para converter BigInt para String
const serializeBigInts = (data) => {
    // Se o dado for um BigInt, converte para string.
    if (typeof data === 'bigint') {
        return data.toString();
    }
    // Se for um array, aplica a função a cada item.
    if (Array.isArray(data)) {
        return data.map(item => serializeBigInts(item));
    }
    if (data === null || data === undefined) {
        return data;
    }
    // Se for um objeto (mas não nulo), aplica a função a cada valor de propriedade.
    if (typeof data === 'object' && data !== null) {
        const res = {};
        for (const key in data) {
            res[key] = serializeBigInts(data[key]);
        }
        return res;
    }
    // Para todos os outros tipos (string, number, boolean, null), retorna o valor original.
    return data;
};


// GET /api/users - Rota para buscar todos os usuários
router.get('/', protect, isAdmin, async (req, res) => {
    const { role } = req.query;
    let conn;
    try {
        conn = await pool.getConnection();
        
        let query;
        let queryParams = [];

        // Lógica de filtro
        if (role) {
            let roleNameInDb, tableName, nameColumn;
            switch(role.toLowerCase()) {
                case 'paciente': 
                    roleNameInDb = 'PACIENTE';
                    tableName = 'patients';
                    nameColumn = 'nome';
                    break;
                case 'profissional': 
                    roleNameInDb = 'PROFISSIONAL';
                    tableName = 'professionals';
                    nameColumn = 'nome';
                    break;
                case 'empresa': 
                    roleNameInDb = 'EMPRESA';
                    tableName = 'companies';
                    nameColumn = 'nome_empresa';
                    break;
                default: 
                    return res.status(400).json({ message: 'Role inválido' });
            }
            // Retorna o ID do usuário e o nome do perfil
            query = `SELECT u.id, p.${nameColumn} as name FROM users u JOIN ${tableName} p ON u.id = p.user_id JOIN roles r ON u.role_id = r.id WHERE r.name = ? ORDER BY name ASC`;
            queryParams.push(roleNameInDb);
        } else {
            // Se não houver filtro, retorna todos os usuários (lógica que já existia)
            query = `
                SELECT u.id, u.email, u.role_id, r.name as role,
                COALESCE(adm.nome, prof.nome, pat.nome, comp.nome_empresa) as name,
                COALESCE(adm.imagem_url, prof.imagem_url, pat.imagem_url, comp.imagem_url) as imagem_url,
                prof.level
                FROM users u JOIN roles r ON u.role_id = r.id
                LEFT JOIN administrators adm ON u.id = adm.user_id
                LEFT JOIN professionals prof ON u.id = prof.user_id
                LEFT JOIN patients pat ON u.id = pat.user_id
                LEFT JOIN companies comp ON u.id = comp.user_id
                ORDER BY u.id;
            `;
        }
        
        const users = await conn.query(query, queryParams);
        res.json(serializeBigInts(users));
    } catch (error) {
        console.error("Erro ao buscar usuários:", error);
        res.status(500).json({ message: 'Erro ao buscar usuários.' });
    } finally {
        if (conn) conn.release();
    }
});

// GET /api/users/role/professionals - Rota de ADMIN para buscar todos os profissionai
router.get('/role/professionals', protect, isAdmin, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        // Query para buscar apenas os usuários com a role 'PROFISSIONAL'
        const query = `
            SELECT 
                p.id,
                p.user_id,
                p.nome,
                p.level,
                p.imagem_url,
                p.especialidade,
                p.abordagem,
                p.visible_web
            FROM professionals p
            ORDER BY p.nome;
        `;
        const professionals = await conn.query(query);
        // Usamos o serializeBigInts que já existe no seu arquivo
        res.json(serializeBigInts(professionals));
    } catch (error)        {
        console.error("Erro ao buscar profissionais:", error);
        res.status(500).json({ message: 'Erro ao buscar profissionais.' });
    } finally {
        if (conn) conn.release();
    }
});

// Atualizar valor padrão da consulta do paciente
router.patch('/professional/patient/:patientId/value', protect, isProfissional, async (req, res) => {
    const { patientId } = req.params;
    const { new_value } = req.body;
    const { userId } = req.user;

    if (new_value === undefined) return res.status(400).json({ message: "Valor inválido." });

    let conn;
    try {
        conn = await pool.getConnection();
        const [prof] = await conn.query("SELECT id FROM professionals WHERE user_id = ?", [userId]);
        if (!prof) return res.status(403).json({ message: 'Acesso negado.' });

        // Atualiza o valor das próximas consultas AGENDADAS deste paciente com este profissional
        // Isso simula a "atualização do valor contratado"
        await conn.query(
            `UPDATE appointments 
             SET session_value = ? 
             WHERE patient_id = ? AND professional_id = ? AND status = 'Agendada' AND appointment_time > NOW()`,
            [new_value, patientId, prof.id]
        );

        res.json({ message: 'Valor atualizado para os próximos agendamentos.' });
    } catch (error) {
        console.error("Erro ao atualizar valor da consulta:", error);
        res.status(500).json({ message: 'Erro ao atualizar valor.' });
    } finally {
        if (conn) conn.release();
    }
});

// ROTA PARA O PROFISSIONAL BUSCAR SEUS PACIENTES E EMPRESAS
router.get('/my-associates', [protect, isProfissional], async (req, res) => {
    const { userId } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();
        const profProfileRows = await conn.query("SELECT id FROM professionals WHERE user_id = ?", [userId]);
        if (!profProfileRows || profProfileRows.length === 0) {
             return res.json({ patients: [], companies: [] });
        }
        const professionalId = profProfileRows[0].id;

        // Query COMPLEXA para buscar métricas financeiras e de datas
        const patientsQuery = `
            SELECT DISTINCT 
                p.id, 
                p.user_id, 
                p.nome, 
                p.cpf, 
                p.telefone, 
                p.data_nascimento, 
                p.imagem_url,
                p.created_at, -- Data do Ingresso
                u.email,
                u.status,
                
                -- Total de Sessões Realizadas (Concluídas)
                (SELECT COUNT(*) 
                 FROM appointments a 
                 WHERE a.patient_id = p.id AND a.professional_id = ? AND a.status = 'Concluída') as total_sessions,

                -- Valor da Última Consulta (Base para edição)
                (SELECT session_value 
                 FROM appointments a 
                 WHERE a.patient_id = p.id AND a.professional_id = ? 
                 ORDER BY a.appointment_time DESC LIMIT 1) as current_value,

                -- Data da Última Sessão (Usada como referência de reajuste/atividade)
                (SELECT appointment_time 
                 FROM appointments a 
                 WHERE a.patient_id = p.id AND a.professional_id = ? 
                 ORDER BY a.appointment_time DESC LIMIT 1) as last_session_date

            FROM patients p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN appointments a ON p.id = a.patient_id
            WHERE a.professional_id = ? OR p.created_by_professional_id = ?
            ORDER BY p.nome ASC;
        `;
        
        // Passamos professionalId 5 vezes para preencher os ? das subqueries e do WHERE principal
        const patients = await conn.query(patientsQuery, [
            professionalId, 
            professionalId, 
            professionalId, 
            professionalId, 
            professionalId
        ]);

        const companies = await conn.query(
            `SELECT DISTINCT c.id, c.user_id, c.nome_empresa FROM companies c
             JOIN patients p ON c.id = p.company_id
             JOIN appointments a ON p.id = a.patient_id
             WHERE a.professional_id = ? AND p.company_id IS NOT NULL`,
            [professionalId]
        );
        
        res.json({ patients: serializeBigInts(patients), companies: serializeBigInts(companies) });
    } catch (error) {
        console.error("Erro ao buscar associados do profissional:", error);
        res.status(500).json({ message: 'Erro ao buscar dados.' });
    } finally {
        if (conn) conn.release();
    }
});

// GET /api/users/:id - Busca um usuário específico com perfil
/* 
router.get('/:id', protect, async (req, res) => {
    const { id } = req.params;
    let conn;
    try {
        conn = await pool.getConnection();

        const users = await conn.query('SELECT id, email, role_id, status FROM users WHERE id = ?', [id]);
        if (!users || users.length === 0) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }
        const user = users[0];
        
        const roles = await conn.query('SELECT name FROM roles WHERE id = ?', [user.role_id]);
        if (!roles || roles.length === 0) {
            return res.status(404).json({ message: 'Papel do usuário não encontrado.' });
        }
        const role = roles[0];
        
        let tableName;
        switch (role.name) {
            case 'ADM': tableName = 'administrators'; break;
            case 'PROFISSIONAL': tableName = 'professionals'; break;
            case 'PACIENTE': tableName = 'patients'; break;
            case 'EMPRESA': tableName = 'companies'; break;
            default: return res.status(400).json({ message: 'Papel inválido.' });
        }

        const profiles = await conn.query(`SELECT * FROM ${tableName} WHERE user_id = ?`, [id]);
        const profile = profiles.length > 0 ? profiles[0] : {};
        
        const fullUser = {
            ...serializeBigInts(user),
            role: role.name,
            profile: serializeBigInts(profile) || {}
        };
        res.json(fullUser);
    } catch (error) {
        console.error("Erro ao buscar perfil do usuário:", error);
        res.status(500).json({ message: 'Erro no servidor.' });
    } finally {
        if (conn) conn.release();
    }
});

*/
router.get('/:id', protect, async (req, res) => {
    const { id } = req.params;
    let conn;
    try {
        conn = await pool.getConnection();

        const users = await conn.query('SELECT id, email, role_id, status FROM users WHERE id = ?', [id]);
        if (!users || users.length === 0) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }
        const user = users[0];
        
        const roles = await conn.query('SELECT name FROM roles WHERE id = ?', [user.role_id]);
        if (!roles || roles.length === 0) {
            return res.status(404).json({ message: 'Papel do usuário não encontrado.' });
        }
        const role = roles[0];
        
        let tableName;
        switch (role.name) {
            case 'ADM': tableName = 'administrators'; break;
            case 'PROFISSIONAL': tableName = 'professionals'; break;
            case 'PACIENTE': tableName = 'patients'; break;
            case 'EMPRESA': tableName = 'companies'; break;
            default: return res.status(400).json({ message: 'Papel inválido.' });
        }

        // SELECT * garante que 'fixed_fee' venha do banco
        const profiles = await conn.query(`SELECT * FROM ${tableName} WHERE user_id = ?`, [id]);
        const profile = profiles.length > 0 ? profiles[0] : {};
        
        const fullUser = {
            ...serializeBigInts(user),
            role: role.name,
            profile: serializeBigInts(profile) || {}
        };
        res.json(fullUser);
    } catch (error) {
        console.error("Erro ao buscar perfil do usuário:", error);
        res.status(500).json({ message: 'Erro no servidor.' });
    } finally {
        if (conn) conn.release();
    }
});



// GET /api/users/patient-profile/:patientId - Rota específica para buscar o perfil de um paciente pelo SEU ID.
router.get('/patient-profile/:patientId', protect, isProfissional, async (req, res) => {
    const { patientId } = req.params;
    let conn;
    try {
        conn = await pool.getConnection();
        // Busca diretamente na tabela 'patients'
        const [patientProfile] = await conn.query('SELECT id, nome FROM patients WHERE id = ?', [patientId]);
        
        if (!patientProfile) {
            return res.status(404).json({ message: 'Perfil do paciente não encontrado.' });
        }
        
        res.json(patientProfile);
    } catch (error) {
        console.error("Erro ao buscar perfil do paciente:", error);
        res.status(500).json({ message: 'Erro no servidor.' });
    } finally {
        if (conn) conn.release();
    }
});
/*
// POST /api/users - Rota para CRIAR um novo usuário com perfil COMPLETO
router.post('/', protect, isAdmin, upload.single('imagem_perfil'), async (req, res) => {
    const { email, password, role_id } = req.body;
    const profileData = JSON.parse(req.body.profileData || '{}');

    if (!email || !password || !role_id || !profileData) {
        return res.status(400).json({ message: 'Dados insuficientes.' });
    }

    if (req.file && req.file.gcsUrl) { // <<< Verifica se gcsUrl existe
        profileData.imagem_url = req.file.gcsUrl; // <<< Linha corrigida
    } else if (req.file) {
        console.warn(`[USER UPDATE] Arquivo ${req.file.originalname} recebido, mas URL GCS não encontrada.`);
        // Decide se quer lançar um erro ou apenas ignorar a imagem na atualização
    }

    if (profileData.data_nascimento && typeof profileData.data_nascimento === 'string') {
        const date = new Date(profileData.data_nascimento);
        // A forma padrão de verificar se uma data é válida em JS é checando se seu tempo não é NaN
        if (!isNaN(date.getTime())) {
            profileData.data_nascimento = date.toISOString().split('T')[0];
        } else {
            // Se a string não for uma data válida, salve como null.
            profileData.data_nascimento = null;
        }
    } else {
        // Se não for uma string (ou for vazia), salve como null.
        profileData.data_nascimento = null;
    }

    let conn;
    try {
        conn = await pool.getConnection();
        const existingUser = await conn.query("SELECT id FROM users WHERE email = ?", [email]);
        if (existingUser.length > 0) {
            return res.status(409).json({ message: 'Este email já está em uso.' });
        }

        await conn.beginTransaction();
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const userResult = await conn.query(
            'INSERT INTO users (email, password, role_id) VALUES (?, ?, ?)',
            [email, hashedPassword, role_id]
        );
        
        let newUserId;
        // Primeiro, verificamos se o resultado é um array (como em [OkPacket, fields])
        if (Array.isArray(userResult) && userResult[0]) {
            newUserId = userResult[0].insertId;
        } 
        // Senão, verificamos se é um objeto direto com a propriedade insertId
        else if (userResult && userResult.insertId) {
            newUserId = userResult.insertId;
        }

        // Se, após ambas as checagens, o ID não for encontrado, lançamos um erro claro.
        if (!newUserId) {
            console.error("Estrutura inesperada do resultado do INSERT:", userResult);
            throw new Error("Não foi possível obter o ID do novo usuário após a inserção.");
        }
        // ===================================================================

        profileData.user_id = newUserId;

        let tableName, fields;
        switch (String(role_id)) {
            case '1':
                tableName = 'administrators';
                fields = ['user_id', 'nome', 'cpf', 'cnpj', 'data_nascimento', 'genero', 'telefone', 'email', 'endereco', 'profissao', 'imagem_url'];
                break;
            case '2':
                tableName = 'professionals';
                fields = ['user_id', 'nome', 'cpf', 'cnpj', 'data_nascimento', 'genero', 'endereco', 'cidade', 'telefone', 'email', 'profissao', 'level', 'modalidade_atendimento', 'especialidade', 'experiencia', 'abordagem', 'tipo_acompanhamento', 'imagem_url', 'fixed_fee'];
                break;
            case '3':
                tableName = 'patients';
                fields = ['user_id', 'nome', 'cpf', 'telefone', 'profissao', 'renda', 'preferencia_gen_atend', 'data_nascimento', 'genero', 'endereco', 'cidade', 'tipo_atendimento', 'modalidade_atendimento', 'imagem_url'];
                break;
            case '4':
                tableName = 'companies';
                fields = ['user_id', 'nome_empresa', 'cnpj', 'num_colaboradores', 'nome_responsavel', 'cargo', 'telefone', 'email_contato', 'descricao', 'tipo_atendimento', 'frequencia', 'expectativa', 'imagem_url'];
                break;
            default:
                throw new Error('Papel inválido');
        }

        const values = fields.map(field => profileData[field] || null);
        const placeholders = fields.map(() => '?').join(',');
        await conn.query(`INSERT INTO ${tableName} (${fields.join(',')}) VALUES (${placeholders})`, values);

        await conn.commit();
        
        // Notificar o novo usuário
        await createNotification(req, newUserId, 'profile_update', 'Sua conta foi criada com sucesso! Configure seu perfil.');
        
        res.status(201).json({ id: String(newUserId), email, role_id });
    } catch (error) {
        if (conn) await conn.rollback();
        console.error("Erro ao criar usuário:", error);
        res.status(500).json({ message: 'Erro ao criar usuário.', error: error.message });
    } finally {
        if (conn) conn.release();
    }
});
*/
// POST /api/users - Rota para CRIAR um novo usuário com perfil COMPLETO
router.post('/', protect, isAdmin, upload.single('imagem_perfil'), async (req, res) => {
    const { email, password, role_id } = req.body;
    const profileData = JSON.parse(req.body.profileData || '{}');

    if (!email || !password || !role_id || !profileData) {
        return res.status(400).json({ message: 'Dados insuficientes.' });
    }

    if (req.file && req.file.gcsUrl) { 
        profileData.imagem_url = req.file.gcsUrl; 
    } else if (req.file) {
        console.warn(`[USER UPDATE] Arquivo ${req.file.originalname} recebido, mas URL GCS não encontrada.`);
    }

    if (profileData.data_nascimento && typeof profileData.data_nascimento === 'string') {
        const date = new Date(profileData.data_nascimento);
        if (!isNaN(date.getTime())) {
            profileData.data_nascimento = date.toISOString().split('T')[0];
        } else {
            profileData.data_nascimento = null;
        }
    } else {
        profileData.data_nascimento = null;
    }

    let conn;
    try {
        conn = await pool.getConnection();
        const existingUser = await conn.query("SELECT id FROM users WHERE email = ?", [email]);
        if (existingUser.length > 0) {
            return res.status(409).json({ message: 'Este email já está em uso.' });
        }

        await conn.beginTransaction();
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const userResult = await conn.query(
            'INSERT INTO users (email, password, role_id) VALUES (?, ?, ?)',
            [email, hashedPassword, role_id]
        );
        
        let newUserId;
        if (Array.isArray(userResult) && userResult[0]) {
            newUserId = userResult[0].insertId;
        } else if (userResult && userResult.insertId) {
            newUserId = userResult.insertId;
        }

        if (!newUserId) {
            console.error("Estrutura inesperada do resultado do INSERT:", userResult);
            throw new Error("Não foi possível obter o ID do novo usuário após a inserção.");
        }

        profileData.user_id = newUserId;

        let tableName, fields;
        switch (String(role_id)) {
            case '1':
                tableName = 'administrators';
                fields = ['user_id', 'nome', 'cpf', 'cnpj', 'data_nascimento', 'genero', 'telefone', 'email', 'endereco', 'profissao', 'imagem_url'];
                break;
            case '2':
                tableName = 'professionals';
                // CORREÇÃO: 'fixed_fee' adicionado na lista de campos permitidos
                fields = ['user_id', 'nome', 'cpf', 'cnpj', 'data_nascimento', 'genero', 'endereco', 'cidade', 'telefone', 'email', 'profissao', 'level', 'modalidade_atendimento', 'especialidade', 'experiencia', 'abordagem', 'tipo_acompanhamento', 'imagem_url', 'fixed_fee'];
                break;
            case '3':
                tableName = 'patients';
                fields = ['user_id', 'nome', 'cpf', 'telefone', 'profissao', 'renda', 'preferencia_gen_atend', 'data_nascimento', 'genero', 'endereco', 'cidade', 'tipo_atendimento', 'modalidade_atendimento', 'imagem_url'];
                break;
            case '4':
                tableName = 'companies';
                fields = ['user_id', 'nome_empresa', 'cnpj', 'num_colaboradores', 'nome_responsavel', 'cargo', 'telefone', 'email_contato', 'descricao', 'tipo_atendimento', 'frequencia', 'expectativa', 'imagem_url'];
                break;
            default:
                throw new Error('Papel inválido');
        }

        const values = fields.map(field => profileData[field] || null);
        const placeholders = fields.map(() => '?').join(',');
        await conn.query(`INSERT INTO ${tableName} (${fields.join(',')}) VALUES (${placeholders})`, values);

        await conn.commit();
        
        await createNotification(req, newUserId, 'profile_update', 'Sua conta foi criada com sucesso! Configure seu perfil.');
        
        res.status(201).json({ id: String(newUserId), email, role_id });
    } catch (error) {
        if (conn) await conn.rollback();
        console.error("Erro ao criar usuário:", error);
        res.status(500).json({ message: 'Erro ao criar usuário.', error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// PUT /api/users/:id - Atualiza um usuário com perfil
router.put('/:id', protect, isAdmin, upload.single('imagem_perfil'), async (req, res) => {
    const { email, role_id, profileData: profileDataJSON } = req.body;
    const profileData = JSON.parse(profileDataJSON || '{}');
    const { id } = req.params;

    if (!email || !role_id) {
        return res.status(400).json({ message: 'Email e Categoria de Usuário são obrigatórios.' });
    }

    if (req.file && req.file.gcsUrl) { 
        profileData.imagem_url = req.file.gcsUrl; 
    } else if (req.file) {
        console.warn(`[USER CREATE] Arquivo ${req.file.originalname} recebido, mas URL GCS não encontrada.`);
    }

    if (profileData.data_nascimento && typeof profileData.data_nascimento === 'string') {
        const date = new Date(profileData.data_nascimento);
        if (!isNaN(date.getTime())) {
            profileData.data_nascimento = date.toISOString().split('T')[0];
        } else {
            profileData.data_nascimento = null;
        }
    } else {
        profileData.data_nascimento = null;
    }

    let conn;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();

        if (req.body.password) {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(req.body.password, salt);
            await conn.query('UPDATE users SET email = ?, role_id = ?, password = ? WHERE id = ?', [email, role_id, hashedPassword, id]);
        } else {
            await conn.query('UPDATE users SET email = ?, role_id = ? WHERE id = ?', [email, role_id, id]);
        }
        
        const roleResult = await conn.query('SELECT name FROM roles WHERE id = ?', [req.body.role_id]);
        const role = roleResult[0].name;
        
        let tableName, allFields;
        switch (role) {
            case 'ADM':
                tableName = 'administrators';
                allFields = ['nome', 'cpf', 'cnpj', 'data_nascimento', 'genero', 'telefone', 'email', 'endereco', 'profissao', 'imagem_url'];
                break;
            case 'PROFISSIONAL':
                tableName = 'professionals';
                // CORREÇÃO: 'fixed_fee' adicionado na lista de campos permitidos para atualização
                allFields = ['nome', 'cpf', 'cnpj', 'data_nascimento', 'genero', 'endereco', 'cidade', 'telefone', 'email', 'profissao', 'level', 'modalidade_atendimento', 'especialidade', 'experiencia', 'abordagem', 'tipo_acompanhamento', 'imagem_url', 'fixed_fee'];
                break;
            case 'PACIENTE':
                tableName = 'patients';
                allFields = ['nome', 'cpf', 'telefone', 'profissao', 'imagem_url', 'renda', 'preferencia_gen_atend', 'data_nascimento', 'genero', 'endereco', 'cidade', 'tipo_atendimento', 'modalidade_atendimento'];
                break;
            case 'EMPRESA':
                tableName = 'companies'; 
                allFields = ['nome_empresa', 'cnpj', 'num_colaboradores', 'nome_responsavel', 'cargo', 'telefone', 'email_contato', 'descricao', 'tipo_atendimento', 'frequencia', 'expectativa', 'imagem_url'];
                break;
            default: throw new Error('Papel inválido');
        }

        const fieldsToUpdate = allFields.filter(field => profileData[field] !== undefined);
        
        if (fieldsToUpdate.length > 0) {
            const setClause = fieldsToUpdate.map(field => `${field} = ?`).join(', ');
            const values = fieldsToUpdate.map(field => profileData[field]);
            await conn.query(`UPDATE ${tableName} SET ${setClause} WHERE user_id = ?`, [...values, id]);
        }
        
        await conn.commit();
        res.json({ message: 'Usuário atualizado com sucesso!' });

    } catch (error) {
        if (conn) await conn.rollback();
        console.error("Erro ao atualizar usuário:", error);
        res.status(500).json({ message: 'Erro ao atualizar usuário.', error: error.message });
    } finally {
        if (conn) conn.release();
    }
});


// DELETE /api/users/:id
router.delete('/:id', protect, isAdmin, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query('DELETE FROM users WHERE id = ?', [req.params.id]);
        res.json({ message: 'Usuário excluído com sucesso.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao excluir usuário.' });
    } finally {
        if (conn) conn.release();
    }
});

// ROTA PARA ADMIN BLOQUEAR/DESBLOQUEAR USUÁRIO
router.patch('/:userId/status', [protect, isAdmin], async (req, res) => {
    const { userId } = req.params;
    const { status } = req.body;
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query("UPDATE users SET status = ? WHERE id = ?", [status, userId]);

        // Adicionar notificação para o usuário afetado
        const message = status === 'active' 
            ? 'Sua conta foi desbloqueada e está ativa novamente.' 
            : 'Sua conta foi bloqueada. Entre em contato com o suporte para mais detalhes.';
        await createNotification(req, userId, 'profile_update', message);


        res.json({ message: `Usuário ${status === 'active' ? 'desbloqueado' : 'bloqueado'}.` });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao alterar status do usuário.' });
    } finally {
        if (conn) conn.release();
    }
});


// Profssional 

// ROTA PARA O PROFISSIONAL CRIAR UM NOVO PACIENTE
router.post('/professional/create-patient', protect, isProfissional, async (req, res) => {
    const { email, password, profileData: profileDataJSON } = req.body;
    const profileData = JSON.parse(profileDataJSON || '{}');
    const { userId: professionalUserId } = req.user;

    if (!email || !password || !profileData.nome) {
        return res.status(400).json({ message: 'Email, senha e nome do paciente são obrigatórios.' });
    }

    let conn;
    try {
        conn = await pool.getConnection();

        // 1. VERIFICAR PERMISSÃO DO PROFISSIONAL PELO SEU 'level'
        const [profProfile] = await conn.query("SELECT id, level FROM professionals WHERE user_id = ?", [professionalUserId]);
        
        // Verifica se o nível está na lista de permitidos
        if (!profProfile || !['Profissional Habilitado', 'Profissional Escola'].includes(profProfile.level)) {
            return res.status(403).json({ message: 'Você não tem permissão para criar pacientes.' });
        }
        const professionalId = profProfile.id;

        // 2. VERIFICAR SE O EMAIL DO PACIENTE JÁ EXISTE
        const [existingUser] = await conn.query("SELECT id FROM users WHERE email = ?", [email]);
        if (existingUser) {
            return res.status(409).json({ message: 'Este email já está em uso por outro usuário.' });
        }

        // 2.5 VERIFICAR SE O CPF JÁ EXISTE (SE FORNECIDO)
        if (profileData.cpf) {
            const [existingCpf] = await conn.query("SELECT id FROM patients WHERE cpf = ?", [profileData.cpf]);
            if (existingCpf) {
                return res.status(409).json({ message: 'Este CPF já está cadastrado.' });
            }
        }

        await conn.beginTransaction();

        // 3. CRIAR O NOVO USUÁRIO (PACIENTE)
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const roleIdPaciente = 3; // ID Fixo para 'PACIENTE'
        //const [userResult] = await conn.query(
        const userResult = await conn.query(
            'INSERT INTO users (email, password, role_id) VALUES (?, ?, ?)',
            [email, hashedPassword, roleIdPaciente]
        );
        //const newPatientUserId = userResult.insertId;
        const newPatientUserId = Array.isArray(userResult) ? userResult[0].insertId : userResult.insertId;

        // 4. CRIAR O PERFIL DO PACIENTE
        profileData.user_id = newPatientUserId;
        profileData.created_by_professional_id = professionalId;
        //const patientFields = ['user_id', 'nome', 'cpf', 'telefone', 'data_nascimento'];
        const patientFields = ['user_id', 'nome', 'cpf', 'telefone', 'data_nascimento', 'created_by_professional_id'];
        const values = patientFields.map(field => profileData[field] || null);
        const placeholders = patientFields.map(() => '?').join(',');
        //const [patientProfileResult] = await conn.query(
        const patientProfileResult = await conn.query(
            `INSERT INTO patients (${patientFields.join(',')}) VALUES (${placeholders})`,
            values
        );
        //const newPatientProfileId = patientProfileResult.insertId;
        const newPatientProfileId = Array.isArray(patientProfileResult) ? patientProfileResult[0].insertId : patientProfileResult.insertId;

        // 5. ASSOCIAR O NOVO PACIENTE AO PROFISSIONAL QUE O CRIOU
        await conn.query(
            'INSERT INTO professional_assignments (professional_id, patient_id) VALUES (?, ?)',
            [professionalId, newPatientProfileId]
        );

        await conn.commit();

        // Notificar o novo paciente que sua conta foi criada
        await createNotification(req, newPatientUserId, 'profile_update', 'Bem-vindo(a)! Sua conta foi criada pelo seu profissional.');

        const responsePayload = { message: 'Paciente criado e associado com sucesso!', userId: newPatientUserId };

        try{
            await sendWelcomeEmail(email, password);
        }catch(emailError){
            console.error("### AVISO: O cadastro do paciente foi um sucesso, mas o envio de e-mail falhou. ###");
            responsePayload.message = 'Paciente criado com sucesso, mas o e-mail de boas-vindas falhou ao ser enviado.';

        }

        res.status(201).json(serializeBigInts(responsePayload));

    } catch (error) {
        if (conn) await conn.rollback();
        console.error("Erro ao criar paciente pelo profissional:", error);
        res.status(500).json({ message: 'Erro interno no servidor ao criar paciente.' });
    } finally {
        if (conn) conn.release();
    }
});


// ROTA PARA O PROFISSIONAL HABILITADO BLOQUEAR/DESBLOQUEAR UM PACIENTE
router.patch('/professional/patient/:patientId/status', protect, isProfissional, async (req, res) => {
    const { patientId } = req.params;
    const { status } = req.body; // 'active' or 'blocked'
    const { userId: professionalUserId } = req.user;

    if (!status || (status !== 'active' && status !== 'blocked')) {
        return res.status(400).json({ message: 'Status inválido. Use "active" ou "blocked".' });
    }

    let conn;
    try {
        conn = await pool.getConnection();

        // 1. OTIMIZAÇÃO: Verifica permissão (level) e vínculo (assignment) em UMA query
        const [profAndLink] = await conn.query(
            `SELECT 
                p.id as professionalId, 
                p.level,
                pat.user_id as patientUserId
            FROM professionals p
            JOIN patients pat ON pat.id = ?
            LEFT JOIN appointments a ON a.patient_id = pat.id AND a.professional_id = p.id
            WHERE p.user_id = ? 
              AND (pat.created_by_professional_id = p.id OR a.professional_id = p.id)
            GROUP BY p.id, p.level, pat.user_id
            LIMIT 1`,
            [patientId, professionalUserId]
        );

        // 2. Valida o resultado da query otimizada
        if (!profAndLink) {
             return res.status(403).json({ message: 'Você não tem permissão para modificar este paciente (vínculo não encontrado).' });
        }
        
        if (!['Profissional Habilitado', 'Profissional Escola'].includes(profAndLink.level)) {
             return res.status(403).json({ message: 'Você não tem permissão para alterar o status de pacientes.' });
        }

        const patientUserId = profAndLink.patientUserId;

        // Inicia a transação APÓS as verificações
        await conn.beginTransaction();

        // 3. ATUALIZAR O STATUS NA TABELA 'users'
        await conn.query("UPDATE users SET status = ? WHERE id = ?", [status, patientUserId]);

        // 4. CRIAR NOTIFICAÇÃO PARA O PACIENTE
        const message = status === 'active' 
            ? 'Sua conta foi desbloqueada pelo seu profissional.' 
            : 'Sua conta foi bloqueada pelo seu profissional. Entre em contato para mais detalhes.';
        
        await createNotification(req, patientUserId, 'profile_update', message);

        await conn.commit();

        res.json({ message: `Status do paciente atualizado para ${status}.`, newStatus: status });

    } catch (error) {
        if (conn) await conn.rollback();
        console.error("Erro ao alterar status do paciente:", error);
        res.status(500).json({ message: 'Erro interno no servidor.' });
    } finally {
        if (conn) conn.release();
    }
});


// ROTA PARA O PROFISSIONAL HABILITADO ATUALIZAR UM PACIENTE
router.put('/professional/patient/:patientId', protect, isProfissional, async (req, res) => {
    const { patientId } = req.params;
    const { profileData } = req.body;
    const { userId: professionalUserId } = req.user;

    if (!profileData) {
        return res.status(400).json({ message: 'Dados do perfil são necessários.' });
    }

    let conn;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction(); // <-- Inicia transação

        // Se a data de nascimento vier como uma string vazia, converte para null
        if (profileData.data_nascimento === '') {
            profileData.data_nascimento = null;
        }

        // 1. VERIFICAR PERMISSÃO DO PROFISSIONAL
        const [profProfile] = await conn.query("SELECT id, level FROM professionals WHERE user_id = ?", [professionalUserId]);
        if (!profProfile || !['Profissional Habilitado', 'Profissional Escola'].includes(profProfile.level)) {
            await conn.rollback();
            return res.status(403).json({ message: 'Você não tem permissão para editar pacientes.' });
        }
        const professionalId = profProfile.id;

        // 2. VERIFICAR VÍNCULO E PEGAR user_id
        const [assignment] = await conn.query(
            `SELECT p.id, p.user_id FROM patients p 
             LEFT JOIN appointments a ON a.patient_id = p.id
             WHERE p.id = ? AND (p.created_by_professional_id = ? OR a.professional_id = ?)
             GROUP BY p.id, p.user_id`, // Garante um resultado único
            [patientId, professionalId, professionalId]
        );

        if (!assignment) {
            await conn.rollback();
            return res.status(403).json({ message: 'Você não tem permissão para editar este paciente.' });
        }
        
        const patientUserId = assignment.user_id; // <-- Pega o user_id do paciente

        // 3. ATUALIZAR OS DADOS DO PERFIL (tabela patients)
        const allowedPatientFields = ['nome', 'cpf', 'telefone', 'data_nascimento']; 
        const fieldsToUpdate = allowedPatientFields.filter(field => profileData[field] !== undefined);
        
        let profileUpdated = false;
        if (fieldsToUpdate.length > 0) {
            const setClause = fieldsToUpdate.map(field => `${field} = ?`).join(', ');
            const values = fieldsToUpdate.map(field => profileData[field]);
            
            await conn.query(`UPDATE patients SET ${setClause} WHERE id = ?`, [...values, patientId]);
            profileUpdated = true;
        }

        // 4. ATUALIZAR DADOS DE USUÁRIO (tabela users) - NOVO
        let userUpdated = false;
        if (profileData.email && typeof profileData.email === 'string') {
            // Verifica se o novo email já está em uso por OUTRO usuário
            const [existingEmail] = await conn.query("SELECT id FROM users WHERE email = ? AND id != ?", [profileData.email, patientUserId]);
            if (existingEmail) {
                await conn.rollback();
                return res.status(409).json({ message: 'Este email já está em uso por outro usuário.' });
            }
            // Atualiza o email na tabela users
            await conn.query("UPDATE users SET email = ? WHERE id = ?", [profileData.email, patientUserId]);
            userUpdated = true;
        }

        // 5. Finalizar
        if (!profileUpdated && !userUpdated) {
            await conn.rollback();
            return res.status(400).json({ message: 'Nenhum campo válido para atualização foi fornecido.' });
        }

        await conn.commit(); // <-- Confirma a transação
        res.json({ message: 'Paciente atualizado com sucesso.' });

    } catch (error) {
        if (conn) await conn.rollback(); // <-- Desfaz em caso de erro
        console.error("Erro ao atualizar paciente:", error);
        res.status(500).json({ message: 'Erro interno no servidor.' });
    } finally {
        if (conn) conn.release();
    }
});


// ROTA PARA O PROFISSIONAL HABILITADO DELETAR UM PACIENTE
router.delete('/professional/patient/:patientId', protect, isProfissional, async (req, res) => {
    const { patientId } = req.params;
    const { userId: professionalUserId } = req.user;

    let conn;
    try {
        conn = await pool.getConnection();
        
        // 1. VERIFICAR PERMISSÃO DO PROFISSIONAL
        const [profProfile] = await conn.query("SELECT id, level FROM professionals WHERE user_id = ?", [professionalUserId]);
        if (!profProfile || !['Profissional Habilitado', 'Profissional Escola'].includes(profProfile.level)) {
            return res.status(403).json({ message: 'Você não tem permissão para excluir pacientes.' });
        }
        const professionalId = profProfile.id;

        // 2. VERIFICAR SE O PACIENTE FOI CRIADO PELO PROFISSIONAL (REGRA MAIS RÍGIDA PARA EXCLUSÃO)
        const [patient] = await conn.query("SELECT id FROM patients WHERE id = ? AND created_by_professional_id = ?", [patientId, professionalId]);
        if (!patient) {
            return res.status(403).json({ message: 'Você só pode excluir pacientes que você mesmo criou.' });
        }

        // 3. DELETAR O USUÁRIO (A TABELA DE PACIENTES SERÁ LIMPA VIA 'ON DELETE CASCADE' DO BANCO)
        const [patientUser] = await conn.query("SELECT user_id FROM patients WHERE id = ?", [patientId]);
        await conn.query("DELETE FROM users WHERE id = ?", [patientUser.user_id]);

        res.json({ message: 'Paciente excluído com sucesso.' });

    } catch (error) {
        console.error("Erro ao excluir paciente:", error);
        res.status(500).json({ message: 'Erro interno no servidor.' });
    } finally {
        if (conn) conn.release();
    }
});

// ====== Public Routes ======
// GET /api/users/professionals/public - Rota PÚBLICA para buscar profissionais visíveis
router.get('/professionals/public', async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        const publicProfessionals = await conn.query(`
            SELECT 
                id, 
                nome,
                profissao, 
                especialidade,
                experiencia,
                abordagem,
                imagem_url
            FROM professionals 
            WHERE visible_web = TRUE
        `);
        res.json(serializeBigInts(publicProfessionals));
    } catch (error) {
        console.error("Erro ao buscar profissionais públicos:", error);
        res.status(500).json({ message: 'Erro ao buscar profissionais.' });
    } finally {
        if (conn) conn.release();
    }
});


// PATCH /api/users/professionals/:id/visibility - Rota de ADMIN para alterar a visibilidade
// Usamos PATCH pois é uma atualização parcial de um recurso
router.patch('/professionals/:id/visibility', protect, isAdmin, async (req, res) => {
    const { id } = req.params;
    const { visible } = req.body; 

    if (typeof visible !== 'boolean') {
        return res.status(400).json({ message: 'O valor de "visible" deve ser um booleano (true ou false).' });
    }

    let conn;
    try {
        conn = await pool.getConnection();
        const result = await conn.query(
            'UPDATE professionals SET visible_web = ? WHERE id = ?',
            [visible, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Profissional não encontrado.' });
        }

        res.json({ message: `Visibilidade do profissional atualizada para ${visible}.` });
    } catch (error) {
        console.error("Erro ao atualizar visibilidade do profissional:", error);
        res.status(500).json({ message: 'Erro no servidor ao atualizar visibilidade.' });
    } finally {
        if (conn) conn.release();
    }
});

// Rota para buscar dados de crescimento de usuários para o dashboard do admin
router.get('/growth-stats', protect, isAdmin, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        const query = `
            SELECT 
                DATE_FORMAT(u.created_at, '%Y-%m') as month,
                r.name as role,
                COUNT(u.id) as count
            FROM users u
            JOIN roles r ON u.role_id = r.id
            WHERE u.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
            GROUP BY month, role
            ORDER BY month, role;
        `;
        const stats = await conn.query(query);
        res.json(serializeBigInts(stats));
    } catch (error) {
        console.error("Erro ao buscar estatísticas de crescimento:", error);
        res.status(500).json({ message: 'Erro ao buscar estatísticas.' });
    } finally {
        if (conn) conn.release();
    }
});

// ====== DASHBOARD ROUTES ======

// ROTA PARA BUSCAR DADOS AGREGADOS PARA O DASHBOARD DO PACIENTE
router.get('/my-dashboard/patient', protect, isPaciente, async (req, res) => {
    const { userId } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();
        const [patientProfile] = await conn.query("SELECT id, nome FROM patients WHERE user_id = ?", [userId]);
        if (!patientProfile) {
            return res.status(404).json({ message: 'Perfil de paciente não encontrado.' });
        }
        const patientId = patientProfile.id;

        // 1. Próximo Agendamento
        const [nextAppointment] = await conn.query(
            `SELECT 
                CAST(a.appointment_time AS CHAR) as appointment_time, 
                p.nome as professional_name, 
                p.imagem_url as professional_photo
             FROM appointments a
             JOIN professionals p ON a.professional_id = p.id
             WHERE a.patient_id = ? AND a.status = 'Agendada' AND a.appointment_time >= NOW()
             ORDER BY a.appointment_time ASC
             LIMIT 1`,
            [patientId]
        );

        // 2. Contagem de Mensagens Não Lidas
        const [unreadMessages] = await conn.query(
            "SELECT COUNT(*) as count FROM messages WHERE recipient_id = ? AND is_read = 0",
            [userId]
        );

        // 3. Estatísticas do Diário de Sonhos
        const [dreamStats] = await conn.query(
            "SELECT COUNT(*) as count, MAX(created_at) as last_entry FROM dream_diary_entries WHERE patient_id = ?",
            [patientId]
        );

        // 4. Faturas Pendentes
        const [pendingInvoices] = await conn.query(
            "SELECT COUNT(*) as count, SUM(amount) as total_value FROM invoices WHERE user_id = ? AND status = 'pending'",
            [userId]
        );
        
        // 5. Dados para o Gráfico de Atividade do Diário (últimos 30 dias)
        const dreamActivity = await conn.query(
            `SELECT CAST(DATE(created_at) AS CHAR) as date, COUNT(*) as count 
            FROM dream_diary_entries 
            WHERE patient_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            GROUP BY date 
            ORDER BY date ASC`,
            [patientId]
        );

        res.json(serializeBigInts({
            patientName: patientProfile.nome,
            nextAppointment: nextAppointment || null,
            unreadMessages: unreadMessages.count || 0,
            dreamStats: {
                count: dreamStats.count || 0,
                lastEntry: dreamStats.last_entry || null
            },
            pendingInvoices: {
                count: pendingInvoices.count || 0,
                totalValue: pendingInvoices.total_value || 0
            },
            dreamActivity: dreamActivity
        }));

    } catch (error) {
        console.error("Erro ao buscar dados do dashboard do paciente:", error);
        res.status(500).json({ message: 'Erro ao carregar dados do dashboard.' });
    } finally {
        if (conn) conn.release();
    }
});

// ROTA PARA BUSCAR DADOS AGREGADOS PARA O DASHBOARD DA EMPRESA - CORRIGIDA
router.get('/my-dashboard/company', protect, async (req, res) => {
    const { userId } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();
        const [companyProfile] = await conn.query("SELECT id, nome_empresa FROM companies WHERE user_id = ?", [userId]);
        if (!companyProfile) {
            return res.status(404).json({ message: 'Perfil de empresa não encontrado.' });
        }
        const companyId = companyProfile.id;

        // KPI 1: Colaboradores Ativos (sem alteração)
        const [activeCollaborators] = await conn.query(
            "SELECT COUNT(*) as count FROM patients WHERE company_id = ?",
            [companyId]
        );

        // KPI 2: Total de Sessões no Mês (CORRIGIDO: Removido o filtro de status)
        const [sessionsThisMonth] = await conn.query(
            `SELECT COUNT(a.id) as count 
             FROM appointments a
             JOIN patients p ON a.patient_id = p.id
             WHERE p.company_id = ? AND MONTH(a.appointment_time) = MONTH(CURDATE()) AND YEAR(a.appointment_time) = YEAR(CURDATE())`,
            [companyId]
        );

        // KPI 3: Consumo no Mês (sem alteração nesta lógica)
        const [monthlyConsumption] = await conn.query(
            `SELECT COALESCE(SUM(a.session_value), 0) as total 
             FROM appointments a
             JOIN patients p ON a.patient_id = p.id
             WHERE p.company_id = ? AND a.status = 'Concluída' AND MONTH(a.appointment_time) = MONTH(CURDATE()) AND YEAR(a.appointment_time) = YEAR(CURDATE())`,
            [companyId]
        );

        // KPI 4: Mensagens Não Lidas (sem alteração)
        const [unreadMessages] = await conn.query(
            "SELECT COUNT(*) as count FROM messages WHERE recipient_id = ? AND is_read = 0",
            [userId]
        );
        
        // KPI 5: Faturas Pendentes (sem alteração)
        const [pendingInvoices] = await conn.query(
            "SELECT COUNT(*) as count FROM invoices WHERE user_id = ? AND status = 'pending'",
            [userId]
        );

        // Próximas 5 Sessões (CORRIGIDO: 'Agendeda' para 'Agendada')
        const upcomingSessions = await conn.query(
            `SELECT CAST(a.appointment_time AS CHAR) as appointment_time, 
                    pat.nome as patient_name, 
                    pat.imagem_url as patient_photo, 
                    prof.nome as professional_name
             FROM appointments a
             JOIN patients pat ON a.patient_id = pat.id
             JOIN professionals prof ON a.professional_id = prof.id
             WHERE pat.company_id = ? AND a.appointment_time >= NOW() AND a.status = 'Agendada'
             ORDER BY a.appointment_time ASC
             LIMIT 5`,
            [companyId]
        );
        
        // Atividade Recente (sem alteração)
        const recentActivity = await conn.query(
            `SELECT a.appointment_time, pat.nome as patient_name, prof.nome as professional_name
             FROM appointments a
             JOIN patients pat ON a.patient_id = pat.id
             JOIN professionals prof ON a.professional_id = prof.id
             WHERE pat.company_id = ? AND a.status = 'Concluída'
             ORDER BY a.appointment_time DESC
             LIMIT 5`,
            [companyId]
        );

        res.json(serializeBigInts({
            companyName: companyProfile.nome_empresa,
            kpis: {
                activeCollaborators: activeCollaborators.count || 0,
                sessionsThisMonth: sessionsThisMonth.count || 0,
                monthlyConsumption: monthlyConsumption.total || 0,
                unreadMessages: unreadMessages.count || 0,
                pendingInvoices: pendingInvoices.count || 0,
            },
            upcomingSessions: upcomingSessions,
            recentActivity: recentActivity
        }));

    } catch (error) {
        console.error("Erro ao buscar dados do dashboard da empresa:", error);
        res.status(500).json({ message: 'Erro ao carregar dados do dashboard.' });
    } finally {
        if (conn) conn.release();
    }
});

// NOVA ROTA PARA BUSCAR DADOS AGREGADOS PARA O DASHBOARD DO PROFISSIONAL
router.get('/my-dashboard/professional', protect, isProfissional, async (req, res) => {
    // O middleware já nos dá o userId do profissional logado
    const { userId } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();

        // 1. Buscar o perfil do profissional (ID e Nome)
        const [professionalProfile] = await conn.query("SELECT id, nome FROM professionals WHERE user_id = ?", [userId]);
        if (!professionalProfile) {
            return res.status(404).json({ message: 'Perfil de profissional não encontrado.' });
        }
        const professionalId = professionalProfile.id;
        const professionalName = professionalProfile.nome;

        // 2. Buscar os próximos 5 agendamentos futuros
        const upcomingAppointments = await conn.query(
            `SELECT 
                a.id,
                CAST(a.appointment_time AS CHAR) as appointment_time, 
                p.nome as patient_name, 
                p.imagem_url as patient_photo
             FROM appointments a
             JOIN patients p ON a.patient_id = p.id
             WHERE a.professional_id = ? AND a.status = 'Agendada' AND a.appointment_time >= NOW()
             ORDER BY a.appointment_time ASC
             LIMIT 5`,
            [professionalId]
        );

        // 3. Calcular Faturamento Líquido (do mês atual, baseado em transações de pagamento)
        const [revenueResult] = await conn.query(
            `SELECT
                COALESCE(SUM(CASE WHEN type = 'payment' THEN amount ELSE 0 END), 0) as totalPayments,
                COALESCE(SUM(CASE WHEN type = 'commission' THEN amount ELSE 0 END), 0) as totalCommissions
             FROM transactions
             WHERE user_id = ?
             AND status = 'completed'
             AND MONTH(transaction_date) = MONTH(CURDATE())
             AND YEAR(transaction_date) = YEAR(CURDATE())`,
            [userId] // Usamos o userId diretamente, que já temos
        );
        const netRevenue = parseFloat(revenueResult.totalPayments) - parseFloat(revenueResult.totalCommissions);

        // 4. Contar Pacientes Ativos (pacientes únicos com quem teve agendamentos)
        const [activePatientsResult] = await conn.query(
            "SELECT COUNT(DISTINCT patient_id) as count FROM appointments WHERE professional_id = ?",
            [professionalId]
        );
        const activePatients = activePatientsResult.count;

        // 5. Contar Mensagens Não Lidas
        const [newMessagesResult] = await conn.query(
            "SELECT COUNT(*) as count FROM messages WHERE recipient_id = ? AND is_read = 0",
            [userId]
        );
        const newMessages = newMessagesResult.count;

        // 6. NOVO: Buscar dados para o gráfico de atividade das sessões
        const sessionsActivity = await conn.query(
            `-- Cria uma tabela temporária em memória com os últimos 30 dias
            WITH RECURSIVE date_series AS (
                SELECT CURDATE() as date
                UNION ALL
                SELECT date - INTERVAL 1 DAY
                FROM date_series
                WHERE date > DATE_SUB(CURDATE(), INTERVAL 29 DAY)
            )
            -- Junta os agendamentos a essa tabela de datas
            SELECT 
                CAST(ds.date AS CHAR) as date,
                COUNT(a.id) as count 
            FROM date_series ds
            LEFT JOIN appointments a 
                ON DATE(a.appointment_time) = ds.date 
                AND a.professional_id = ?
            GROUP BY ds.date
            ORDER BY ds.date ASC`,
            [professionalId]
        );

        // 7. Montar e enviar a resposta final
        res.json(serializeBigInts({
            professionalName,
            upcomingAppointments,
            netRevenue,
            activePatients,
            newMessages,
            sessionsActivity // Adicionando os dados do gráfico à resposta
        }));

    } catch (error) {
        console.error("Erro ao buscar dados do dashboard do profissional:", error);
        res.status(500).json({ message: 'Erro ao carregar dados do dashboard.' });
    } finally {
        if (conn) conn.release();
    }
});


// ROTA PARA BUSCAR DADOS AGREGADOS PARA O DASHBOARD DO ADMIN
router.get('/dashboard/admin-stats', protect, isAdmin, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        const adminUserId = req.user.userId;

        const [
            growthStats,
            triageSummary,
            pendingConfirmation,
            scheduledMeetings,
            todaysAgenda, // <-- NOVA VARIÁVEL
            unreadMessages,
            latestBlogs,
            featuredProfessionals,
            annualRevenue,      
            monthlyRevenue,     
            pendingInvoices     
        ] = await Promise.all([
            // 1. Gráfico de Crescimento de Usuários
            conn.query(`
                SELECT DATE_FORMAT(u.created_at, '%Y-%m') as month, r.name as role, COUNT(u.id) as count
                FROM users u JOIN roles r ON u.role_id = r.id
                WHERE u.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
                GROUP BY month, role ORDER BY month, role;
            `),
            // 2. Resumo da Triagem
            conn.query(`
                SELECT 
                    (SELECT COUNT(*) FROM triagem_pacientes WHERE status = 'Pendente') as pacientes,
                    (SELECT COUNT(*) FROM triagem_profissionais WHERE status = 'Pendente') as profissionais,
                    (SELECT COUNT(*) FROM triagem_empresas WHERE status = 'Pendente') as empresas;
            `),
            // 3. Agendamentos Pendentes de Confirmação
            conn.query("SELECT id FROM triagem_appointments WHERE status = 'Pendente'"),

            // 4. Reuniões Agendadas (A contagem de KPI continua aqui, mas a lista será buscada abaixo)
            conn.query("SELECT ta.id FROM triagem_appointments ta JOIN admin_availability aa ON ta.availability_id = aa.id WHERE ta.status = 'Confirmado' AND aa.start_time >= NOW()"),

            // 5. (NOVO E UNIFICADO) Query da Agenda do Dia
            conn.query(`
                -- Busca Sessões de Atendimento
                SELECT
                    a.id,
                    CAST(a.appointment_time AS CHAR) AS event_time,
                    'Sessão' AS type,
                    COALESCE(p.nome, '(Paciente Removido)') AS main_person,
                    COALESCE(prof.nome, '(Profissional Removido)') AS secondary_person
                FROM appointments a
                LEFT JOIN professionals prof ON a.professional_id = prof.id
                LEFT JOIN patients p ON a.patient_id = p.id
                WHERE
                    DATE(a.appointment_time) = CURDATE()
                    AND a.status = 'Agendada'
                
                UNION ALL
                
                -- Busca Reuniões de Triagem
                SELECT
                    ta.id,
                    CAST(aa.start_time AS CHAR) AS event_time,
                    'Triagem' AS type,
                    ta.user_name AS main_person,
                    ta.triagem_type AS secondary_person
                FROM triagem_appointments ta
                JOIN admin_availability aa ON ta.availability_id = aa.id
                WHERE
                    DATE(aa.start_time) = CURDATE()
                    AND ta.status = 'Confirmado'
                
                -- Ordena a lista unificada por hora
                ORDER BY event_time ASC;
            `),


            // 6. Mensagens Não Lidas
            conn.query("SELECT COUNT(*) as count FROM messages WHERE recipient_id = ? AND is_read = 0", [adminUserId]),

            // 7. Últimos Blogs
            conn.query("SELECT id, title, image_url, excerpt, likes FROM blog_posts ORDER BY created_at DESC LIMIT 3"),

            // 8. Profissionais em Destaque (busca 6 aleatórios para o widget)
            conn.query(`
                SELECT id, user_id, nome, imagem_url, especialidade, abordagem 
                FROM professionals 
                ORDER BY RAND() 
                LIMIT 6
            `),
            // 9. (NOVO) Faturamento Bruto Anual (mensalizado)
            conn.query(`
                SELECT
                    DATE_FORMAT(transaction_date, '%Y-%m') as month,
                    SUM(amount) as totalRevenue
                FROM transactions
                WHERE type = 'commission' AND status = 'completed'
                AND transaction_date >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
                GROUP BY month
                ORDER BY month ASC
            `),
            // 10. (NOVO) Faturamento Bruto do Mês Atual
            conn.query(`
                SELECT SUM(amount) as monthlyRevenue
                FROM transactions
                WHERE type = 'commission' AND status = 'completed'
                AND MONTH(transaction_date) = MONTH(CURDATE())
                AND YEAR(transaction_date) = YEAR(CURDATE())
            `),
            // 11. (NOVO) Cobranças Pendentes do Mês Atual
            conn.query(`
                SELECT COUNT(id) as pendingInvoices
                FROM invoices
                WHERE DATE_FORMAT(due_date, '%Y-%m') = DATE_FORMAT(NOW(), '%Y-%m') AND status = 'Pendente'
            `)
        ]);

        const summaryData = triageSummary[0];
        
        // Monta o objeto final e o envia de uma vez.
        res.json(serializeBigInts({
            growthStats,
            kpis: {
                pendingTriage: summaryData.pacientes + summaryData.profissionais + summaryData.empresas,
                pendingConfirmation: pendingConfirmation.length,
                scheduledMeetings: scheduledMeetings.length,
                unreadMessages: unreadMessages[0].count,
                // KPIs FINANCEIROS AGORA CORRIGIDOS
                monthlyRevenue: monthlyRevenue[0].monthlyRevenue || 0,
                pendingInvoices: pendingInvoices[0].pendingInvoices || 0,
            },
            agenda: {
                todaysAgenda: todaysAgenda
            },
            siteContent: {
                latestBlogs,
                featuredProfessionals
            },
            // DADOS DO GRÁFICO AGORA CORRIGIDOS
            annualRevenueData: annualRevenue,
        }));

    } catch (error) {
        console.error("Erro ao buscar dados do dashboard do admin:", error);
        res.status(500).json({ message: 'Erro ao carregar dados do dashboard.' });
    } finally {
        if (conn) conn.release();
    }
});


// GET /api/users/settings/payment - Busca as configurações de pagamento do usuário logado
router.get('/settings/payment', protect, async (req, res) => {
    const { userId, role } = req.user;

    // Apenas Admins e Profissionais têm configurações de pagamento
    if (role !== 'ADM' && role !== 'PROFISSIONAL') {
        return res.json({}); // Retorna um objeto vazio para outros perfis
    }

    let conn;
    try {
        conn = await pool.getConnection();
        const tableName = role === 'ADM' ? 'administrators' : 'professionals';
        
        const [settings] = await conn.query(
            `SELECT cpf, cnpj, pix_token FROM ${tableName} WHERE user_id = ?`,
            [userId]
        );

        if (!settings) {
            return res.status(404).json({ message: 'Perfil de pagamento não encontrado.' });
        }

        res.json(serializeBigInts(settings));

    } catch (error) {
        console.error("Erro ao buscar configurações de pagamento:", error);
        res.status(500).json({ message: 'Erro no servidor ao buscar configurações.' });
    } finally {
        if (conn) conn.release();
    }
});

// PUT /api/users/settings/payment - Atualiza a chave PIX do usuário logado
router.put('/settings/payment', protect, async (req, res) => {
    const { userId, role } = req.user;
    const { pix_token } = req.body;

    if (role !== 'ADM' && role !== 'PROFISSIONAL') {
        return res.status(403).json({ message: 'Acesso negado.' });
    }
    
    if (typeof pix_token === 'undefined') {
        return res.status(400).json({ message: 'A chave PIX é obrigatória.' });
    }

    let conn;
    try {
        conn = await pool.getConnection();
        const tableName = role === 'ADM' ? 'administrators' : 'professionals';

        await conn.query(
            `UPDATE ${tableName} SET pix_token = ? WHERE user_id = ?`,
            [pix_token, userId]
        );

        res.json({ message: 'Chave PIX atualizada com sucesso!' });

    } catch (error) {
        console.error("Erro ao atualizar chave PIX:", error);
        res.status(500).json({ message: 'Erro no servidor ao salvar a chave PIX.' });
    } finally {
        if (conn) conn.release();
    }
});


// ROTA PARA ADMIN: Buscar pacientes vinculados a um profissional específico
router.get('/:userId/linked-patients', protect, isAdmin, async (req, res) => {
    const targetUserId = req.params.userId;
    let conn;
    try {
        conn = await pool.getConnection();

        // 1. Descobrir o ID do profissional na tabela professionals baseado no user_id
        const [prof] = await conn.query("SELECT id FROM professionals WHERE user_id = ?", [targetUserId]);
        
        if (!prof) {
            return res.json([]); // Não é profissional ou não encontrado
        }
        const professionalId = prof.id;

        // 2. Buscar pacientes vinculados (mesma lógica do /my-associates)
        // Vínculo por criação (created_by) ou por agendamento (appointments)
        const query = `
            SELECT DISTINCT 
                p.id, 
                p.nome, 
                p.imagem_url
            FROM patients p
            LEFT JOIN appointments a ON p.id = a.patient_id
            WHERE a.professional_id = ? OR p.created_by_professional_id = ?
            ORDER BY p.nome ASC
        `;

        const patients = await conn.query(query, [professionalId, professionalId]);
        res.json(serializeBigInts(patients));

    } catch (error) {
        console.error("Erro ao buscar pacientes vinculados:", error);
        res.status(500).json({ message: 'Erro ao buscar pacientes vinculados.' });
    } finally {
        if (conn) conn.release();
    }
});



module.exports = router;