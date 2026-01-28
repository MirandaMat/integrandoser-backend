const express = require('express');
const pool = require('../config/db.js');
const bcrypt = require('bcryptjs');
const { protect, isAdmin } = require('../middleware/authMiddleware.js');
const { sendWelcomeEmail } = require('../config/mailer.js');
const { createNotification } = require('../services/notificationService.js'); 
const router = express.Router();


// Função auxiliar para converter BigInt para String
const serializeBigInts = (data) => {
    if (data === null || data === undefined) return data;
    const isArray = Array.isArray(data);
    const dataToProcess = isArray ? data : [data];
    const processedData = dataToProcess.map(item => {
        const newItem = {};
        for (const key in item) {
            if (typeof item[key] === 'bigint') newItem[key] = item[key].toString();
            else newItem[key] = item[key];
        }
        return newItem;
    });
    return isArray ? processedData : processedData[0];
};


// Função auxiliar para notificar todos os administradores
const notifyAdmins = async (req, type, message) => {
    let conn;
    try {
        conn = await pool.getConnection();
        const admins = await conn.query("SELECT id FROM users WHERE role_id = (SELECT id FROM roles WHERE name = 'ADM')");
        for (const admin of admins) {
            await createNotification(req, admin.id, type, message);
        }
    } catch (error) {
        console.error("Falha ao notificar administradores:", error);
    } finally {
        if (conn) conn.release();
    }
};

// --- ROTAS DE SUBMISSÃO DE FORMULÁRIO (PÚBLICAS) ---

// Rota para receber submissão do formulário de PACIENTE
router.post('/paciente', async (req, res) => {
    const b = req.body;
    
    // Mapeamento flexível
    const nome_completo = b.nome_completo || b.nome || b.name || b.fullname;
    const email = b.email || b.e_mail;
    const cpf = b.cpf;
    const telefone = b.telefone || b.celular || b.whatsapp;
    
    // Tratamento de data
    let data_nascimento = b.data_nascimento;
    if (!data_nascimento || data_nascimento === '') data_nascimento = null;

    const genero = b.genero;
    const endereco = b.endereco;
    const cidade = b.cidade;
    const estado = b.estado ? b.estado.substring(0, 2).toUpperCase() : null;
    
    // Campos JSON/Arrays
    const terapia_buscada_val = b.terapia_buscada || b.motivo || [];
    const terapia_buscada = Array.isArray(terapia_buscada_val) ? JSON.stringify(terapia_buscada_val) : JSON.stringify([terapia_buscada_val]);
    
    const modalidade = b.modalidade;
    const profissao = b.profissao;
    const renda_familiar = b.renda_familiar || b.renda;
    const preferencia_genero_profissional = b.preferencia_genero_profissional;
    const feedback_questionario = b.feedback_questionario;
    let concorda_termos = 0;
    if (Array.isArray(b.concorda_termos)) {
        concorda_termos = b.concorda_termos.length > 0 ? 1 : 0;
    } else {
        concorda_termos = b.concorda_termos ? 1 : 0;
    }

    if (!nome_completo) return res.status(400).json({ message: "Erro: O campo 'Nome Completo' é obrigatório." });
    if (!email) return res.status(400).json({ message: "Erro: O campo 'Email' é obrigatório." });

    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query(
            "INSERT INTO triagem_pacientes (nome_completo, email, cpf, data_nascimento, genero, telefone, endereco, cidade, estado, terapia_buscada, modalidade, profissao, renda_familiar, preferencia_genero_profissional, feedback_questionario, concorda_termos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [nome_completo, email, cpf, data_nascimento, genero, telefone, endereco, cidade, estado, terapia_buscada, modalidade, profissao, renda_familiar, preferencia_genero_profissional, feedback_questionario, concorda_termos]
        );

        await notifyAdmins(req, 'new_triage', `Nova triagem de paciente pendente: ${nome_completo}.`);

        res.status(201).json({ message: 'Formulário enviado com sucesso! Entraremos em contato em breve.' });
    } catch (error) {
        console.error("Erro ao salvar triagem de paciente:", error);
        res.status(500).json({ message: 'Erro interno ao salvar formulário. Tente novamente.' });
    } finally {
        if (conn) conn.release();
    }
});


// Rota para receber submissão do formulário de EMPRESA
router.post('/empresa', async (req, res) => {
    const b = req.body;

    const nome_empresa = b.nome_empresa || b.empresa || b.nome;
    const email = b.email;
    const cnpj = b.cnpj;
    const num_colaboradores = b.num_colaboradores || 0;
    const nome_responsavel = b.nome_responsavel || b.responsavel;
    const cargo_responsavel = b.cargo_responsavel || b.cargo;
    const telefone = b.telefone || b.celular;
    const caracterizacao_demanda = b.caracterizacao_demanda || b.demanda;
    const estado = b.estado ? b.estado.substring(0, 2).toUpperCase() : null;
    
    // Tratamento de JSON
    const tipo_atendimento_val = b.tipo_atendimento_desejado || [];
    const tipo_atendimento_desejado = Array.isArray(tipo_atendimento_val) ? JSON.stringify(tipo_atendimento_val) : JSON.stringify([tipo_atendimento_val]);
    
    const publico_alvo_val = b.publico_alvo || [];
    const publico_alvo = Array.isArray(publico_alvo_val) ? JSON.stringify(publico_alvo_val) : JSON.stringify([publico_alvo_val]);

    const frequencia_desejada = b.frequencia_desejada;
    const expectativas = b.expectativas;

    if (!nome_empresa || !email) {
        return res.status(400).json({ message: "Nome da Empresa e Email são obrigatórios." });
    }

    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query(
            "INSERT INTO triagem_empresas (nome_empresa, email, cnpj, num_colaboradores, nome_responsavel, cargo_responsavel, telefone, estado, caracterizacao_demanda, tipo_atendimento_desejado, publico_alvo, frequencia_desejada, expectativas) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [nome_empresa, email, cnpj, num_colaboradores, nome_responsavel, cargo_responsavel, telefone, estado, caracterizacao_demanda, tipo_atendimento_desejado, publico_alvo, frequencia_desejada, expectativas]
        );

        await notifyAdmins(req, 'new_triage', `Nova triagem de empresa pendente: ${nome_empresa}.`);

        res.status(201).json({ message: 'Formulário enviado com sucesso! Entraremos em contato.' });
    } catch (error) {
        console.error("Erro ao salvar triagem de empresa:", error);
        res.status(500).json({ message: 'Erro ao enviar formulário.' });
    } finally {
        if (conn) conn.release();
    }
});

// Rota para receber submissão do formulário de PROFISSIONAL
router.post('/profissional', async (req, res) => {
    const b = req.body;

    const nome_completo = b.nome_completo || b.nome;
    const email = b.email;
    const cpf = b.cpf;  
    const cnpj = b.cnpj;
    const endereco = b.endereco;
    const cidade = b.cidade;
    const estado = b.estado ? b.estado.substring(0, 2).toUpperCase() : null;
    const telefone = b.telefone || b.celular;
    
    let data_nascimento = b.data_nascimento;
    if (!data_nascimento || data_nascimento === '') data_nascimento = null;

    const nivel_profissional = b.nivel_profissional;
    const aluno_tavola = b.aluno_tavola; 
    const modalidade = b.modalidade;
    const especialidade = b.especialidade;
    const instituicao_formacao = b.instituicao_formacao;
    const faz_supervisao = b.faz_supervisao;
    const palavras_chave_abordagens = b.palavras_chave_abordagens || b.abordagem;
    const faz_analise_pessoal = b.faz_analise_pessoal;
    const duvidas_sugestoes = b.duvidas_sugestoes;

    if (!nome_completo || !email) {
        return res.status(400).json({ message: "Nome e Email são obrigatórios." });
    }

    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query(
            "INSERT INTO triagem_profissionais (nome_completo, email, cpf, cnpj, data_nascimento, endereco, cidade, estado, telefone, nivel_profissional, aluno_tavola, modalidade, especialidade, instituicao_formacao, faz_supervisao, palavras_chave_abordagens, faz_analise_pessoal, duvidas_sugestoes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [nome_completo, email, cpf, cnpj, data_nascimento, endereco, cidade, estado, telefone, nivel_profissional, aluno_tavola, modalidade, especialidade, instituicao_formacao, faz_supervisao, palavras_chave_abordagens, faz_analise_pessoal, duvidas_sugestoes]
        );

        await notifyAdmins(req, 'new_triage', `Nova triagem de profissional pendente: ${nome_completo}.`);

        res.status(201).json({ message: 'Formulário enviado com sucesso! Analisaremos seus dados e entraremos em contato.' });
    } catch (error) {
        console.error("Erro ao salvar triagem de profissional:", error);
        res.status(500).json({ message: 'Erro ao enviar formulário.' });
    } finally {
        if (conn) conn.release();
    }
});


// GET /api/triagem/summary - Busca a contagem de pendentes para os cards
router.get('/summary', protect, isAdmin, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        
        const pacienteRows = await conn.query("SELECT COUNT(*) as count FROM triagem_pacientes WHERE status COLLATE utf8mb4_general_ci = 'Pendente'");
        const profissionalRows = await conn.query("SELECT COUNT(*) as count FROM triagem_profissionais WHERE status COLLATE utf8mb4_general_ci = 'Pendente'");
        const empresaRows = await conn.query("SELECT COUNT(*) as count FROM triagem_empresas WHERE status COLLATE utf8mb4_general_ci = 'Pendente'");
        
        const pacientesCount = pacienteRows[0] ? pacienteRows[0].count : 0;
        const profissionaisCount = profissionalRows[0] ? profissionalRows[0].count : 0;
        const empresasCount = empresaRows[0] ? empresaRows[0].count : 0;

        const summaryData = {
            pacientes: String(pacientesCount),
            profissionais: String(profissionaisCount),
            empresas: String(empresasCount)
        };
        
        res.json(summaryData);
    } catch (error) {
        console.error("Erro ao buscar resumo da triagem:", error);
        res.status(500).json({ message: 'Erro ao buscar resumo.' });
    } finally {
        if (conn) conn.release();
    }
});


// Busca os detalhes de uma submissão, incluindo dados de agendamento se houver
router.get('/detail/:type/:id', protect, isAdmin, async (req, res) => {
    const { type, id } = req.params;
    let conn;
    let tableName;

    switch (type) {
        case 'pacientes': tableName = 'triagem_pacientes'; break;
        case 'profissionais': tableName = 'triagem_profissionais'; break;
        case 'empresas': tableName = 'triagem_empresas'; break;
        default: return res.status(400).json({ message: 'Tipo inválido.' });
    }

    try {
        conn = await pool.getConnection();
        
        const query = `
            SELECT 
                t.*,
                a.id as appointment_id,
                s.start_time,
                a.meeting_link,
                a.status as appointment_status
            FROM ${tableName} t
            LEFT JOIN triagem_appointments a 
                ON t.id = a.triagem_id 
                AND a.triagem_type = ?
                AND a.status != 'Cancelado'
            LEFT JOIN admin_availability s
                ON a.availability_id = s.id
            WHERE t.id = ?
        `;
        
        const rows = await conn.query(query, [type, id]);
        const detail = rows[0]; 
        
        if (!detail) {
            return res.status(404).json({ message: 'Registro não encontrado.' });
        }
        
        const parseJsonField = (field) => {
            try { return field ? JSON.parse(field) : []; } 
            catch (e) { return field ? [field] : []; }
        };

        if (type === 'pacientes') {
            detail.terapia_buscada = parseJsonField(detail.terapia_buscada);
        } else if (type === 'empresas') {
            detail.tipo_atendimento_desejado = parseJsonField(detail.tipo_atendimento_desejado);
            detail.publico_alvo = parseJsonField(detail.publico_alvo);
        }

        res.json(serializeBigInts(detail));
    } catch (error) {
        console.error(`Erro ao buscar detalhes da triagem para ${type}:`, error);
        res.status(500).json({ message: 'Erro ao buscar detalhes.' });
    } finally {
        if (conn) conn.release();
    }
});


// PATCH /api/triagem/status/:type/:id - Atualiza o status de uma submissão
router.patch('/status/:type/:id', protect, isAdmin, async (req, res) => {
    const { type, id } = req.params;
    const { status } = req.body;
    let conn;
    let tableName;

    const validStatus = ['Pendente', 'Agendado', 'Confirmado', 'Não confirmado'];
    if (!validStatus.includes(status)) {
        return res.status(400).json({ message: 'Status inválido.' });
    }

    switch (type) {
        case 'pacientes': tableName = 'triagem_pacientes'; break;
        case 'profissionais': tableName = 'triagem_profissionais'; break;
        case 'empresas': tableName = 'triagem_empresas'; break;
        default: return res.status(400).json({ message: 'Tipo inválido.' });
    }

    try {
        conn = await pool.getConnection();
        await conn.query(`UPDATE ${tableName} SET status = ? WHERE id = ?`, [status, id]);

        if (status === 'Confirmado') {
             await createNotification(req, req.user.userId, 'new_appointment', `Triagem #${id} (${type}) confirmada por você.`);
        }
        
        res.json({ message: 'Status atualizado com sucesso!' });

    } catch (error) {
        console.error(`Erro ao atualizar status para ${type}:`, error);
        res.status(500).json({ message: 'Erro ao atualizar status.' });
    } finally {
        if (conn) conn.release();
    }
});

// DELETE /api/triagem/:type/:id - Deleta um registro de triagem permanentemente
router.delete('/:type/:id', protect, isAdmin, async (req, res) => {
    const { type, id } = req.params;
    let conn;
    let tableName;

    switch (type) {
        case 'pacientes': tableName = 'triagem_pacientes'; break;
        case 'profissionais': tableName = 'triagem_profissionais'; break;
        case 'empresas': tableName = 'triagem_empresas'; break;
        default: return res.status(400).json({ message: 'Tipo de triagem inválido.' });
    }

    try {
        conn = await pool.getConnection();
        const result = await conn.query(`DELETE FROM ${tableName} WHERE id = ?`, [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Registro não encontrado para exclusão.' });
        }

        res.status(204).send();

    } catch (error) {
        console.error(`Erro ao deletar registro de triagem para ${type}:`, error);
        res.status(500).json({ message: 'Erro interno ao deletar registro.' });
    } finally {
        if (conn) conn.release();
    }
});

// GET /api/triagem/list/nao-confirmados - Busca "Não confirmados"
router.get('/nao-confirmados', protect, isAdmin, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        
        const pRows = await conn.query(`SELECT id, nome_completo as nome, email, status, created_at, 'pacientes' as type FROM triagem_pacientes WHERE status COLLATE utf8mb4_general_ci = 'Não confirmado'`);
        const prRows = await conn.query(`SELECT id, nome_completo as nome, email, status, created_at, 'profissionais' as type FROM triagem_profissionais WHERE status COLLATE utf8mb4_general_ci = 'Não confirmado'`);
        const eRows = await conn.query(`SELECT id, nome_empresa as nome, email, status, created_at, 'empresas' as type FROM triagem_empresas WHERE status COLLATE utf8mb4_general_ci = 'Não confirmado'`);

        const rowsP = Array.isArray(pRows) ? pRows : [];
        const rowsPr = Array.isArray(prRows) ? prRows : [];
        const rowsE = Array.isArray(eRows) ? eRows : [];

        const combinedList = [...rowsP, ...rowsPr, ...rowsE];
        combinedList.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        res.json(serializeBigInts(combinedList));
    } catch (error) {
        console.error("Erro ao buscar lista de não confirmados:", error);
        res.status(500).json({ message: 'Erro ao buscar lista.' });
    } finally {
        if (conn) conn.release();
    }
});


// GET /api/triagem/list/:type - Busca a lista de submissões por tipo
router.get('/list/:type', protect, isAdmin, async (req, res) => {
    const { type } = req.params;
    let conn;
    let tableName, nameColumn;

    switch (type) {
        case 'pacientes': tableName = 'triagem_pacientes'; nameColumn = 'nome_completo'; break;
        case 'profissionais': tableName = 'triagem_profissionais'; nameColumn = 'nome_completo'; break;
        case 'empresas': tableName = 'triagem_empresas'; nameColumn = 'nome_empresa'; break;
        default: return res.status(400).json({ message: 'Tipo inválido.' });
    }

    try {
        conn = await pool.getConnection();
        const query = `SELECT id, ${nameColumn} as nome, email, telefone, status, created_at FROM ${tableName} ORDER BY created_at DESC`;
        const list = await conn.query(query);
        res.json(serializeBigInts(list));
    } catch (error) {
        console.error(`Erro ao buscar lista de triagem para ${type}:`, error);
        res.status(500).json({ message: 'Erro ao buscar lista.' });
    } finally {
        if (conn) conn.release();
    }
});


// Rota para confirmar um cadastro da triagem e criar o usuário oficial
router.post('/confirm/:type/:id', protect, isAdmin, async (req, res) => {
    const { type, id } = req.params;
    const { userId: adminUserId } = req.user;
    
    let conn;
    let sourceTable, targetTable, roleId;

    switch (type) {
        case 'pacientes': 
            sourceTable = 'triagem_pacientes'; targetTable = 'patients'; roleId = 3; break;
        case 'profissionais': 
            sourceTable = 'triagem_profissionais'; targetTable = 'professionals'; roleId = 2; break;
        case 'empresas': 
            sourceTable = 'triagem_empresas'; targetTable = 'companies'; roleId = 4; break;
        default: 
            return res.status(400).json({ message: 'Tipo inválido.' });
    }

    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();

        const rows = await conn.query(`SELECT * FROM ${sourceTable} WHERE id = ?`, [id]);
        
        if (!rows || rows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Registro de triagem não encontrado.' });
        }
        const triagemData = rows[0];

        const existingUsers = await conn.query('SELECT id FROM users WHERE email = ?', [triagemData.email]);
        if (existingUsers.length > 0) {
            await conn.rollback();
            return res.status(409).json({ message: 'Este e-mail já pertence a um usuário cadastrado.' });
        }

        const tempPasswordSource = (triagemData.telefone?.substring(0, 4) || 'mudar') + ((triagemData.nome_completo || triagemData.nome_empresa)?.substring(0, 4).toLowerCase() || 'senha');
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(tempPasswordSource, salt);

        const userResult = await conn.query('INSERT INTO users (email, password, role_id) VALUES (?, ?, ?)', [triagemData.email, hashedPassword, roleId]);
        const newUserId = userResult.insertId;

        // Bloco de mapeamento de dados (profileData)
        let profileData = {};
        if (type === 'pacientes') {
            profileData = {
                user_id: newUserId, 
                nome: triagemData.nome_completo, 
                cpf: triagemData.cpf,
                genero: triagemData.genero,
                data_nascimento: triagemData.data_nascimento, 
                telefone: triagemData.telefone, 
                endereco: triagemData.endereco, 
                cidade: triagemData.cidade,
                estado: triagemData.estado,
                modalidade_atendimento: triagemData.modalidade, 
                profissao: triagemData.profissao, 
                renda: parseFloat(triagemData.renda_familiar?.match(/[\d,.]+/g)?.join('').replace('.', '').replace(',', '.') || 0),
                preferencia_gen_atend: triagemData.preferencia_genero_profissional,
                tipo_atendimento: JSON.stringify(triagemData.terapia_buscada)
            };
        } else if (type === 'profissionais') {
            profileData = {
                user_id: newUserId, 
                nome: triagemData.nome_completo, 
                email: triagemData.email, 
                cpf: triagemData.cpf, 
                cnpj: triagemData.cnpj,
                data_nascimento: triagemData.data_nascimento, 
                endereco: triagemData.endereco,
                cidade: triagemData.cidade, 
                estado: triagemData.estado,
                telefone: triagemData.telefone, 
                modalidade_atendimento: triagemData.modalidade,
                especialidade: triagemData.especialidade, 
                abordagem: triagemData.palavras_chave_abordagens,
                level: triagemData.nivel_profissional === 'Estudante' ? 'Estagiário' : 'Profissional'
            };
        } else if (type === 'empresas') {
             profileData = {
                user_id: newUserId, nome_empresa: triagemData.nome_empresa, email_contato: triagemData.email, cnpj: triagemData.cnpj,
                num_colaboradores: parseInt(triagemData.num_colaboradores, 10) || 0, nome_responsavel: triagemData.nome_responsavel,
                cargo: triagemData.cargo_responsavel,
                telefone: triagemData.telefone, descricao: triagemData.caracterizacao_demanda,
                estado: triagemData.estado,
                tipo_atendimento: JSON.stringify(triagemData.tipo_atendimento_desejado),
                frequencia: triagemData.frequencia_desejada,
                expectativa: triagemData.expectativas
            };
        }
        
        const fields = Object.keys(profileData);
        const values = Object.values(profileData);
        const placeholders = fields.map(() => '?').join(',');

        await conn.query(`INSERT INTO ${targetTable} (${fields.join(',')}) VALUES (${placeholders})`, values);
        
        await conn.query(`DELETE FROM ${sourceTable} WHERE id = ?`, [id]);

        await conn.commit();

        await createNotification(req, adminUserId, 'profile_update', `Novo usuário (${type.slice(0,-1)}) criado a partir da triagem #${id}.`);

        try {
            await sendWelcomeEmail(triagemData.email, tempPasswordSource); 
            return res.status(201).json({ 
                message: `Usuário ${type.slice(0, -1)} criado com sucesso! E-mail de boas-vindas enviado.`,
                tempPassword: tempPasswordSource
            });
        } catch (emailError) {
            console.error("### AVISO: A migração do usuário foi um sucesso, mas o envio de e-mail falhou. ###");
            return res.status(201).json({ 
                message: `Usuário ${type.slice(0, -1)} criado, MAS O E-MAIL DE BOAS-VINDAS FALHOU.`,
                tempPassword: tempPasswordSource
            });
        }

    } catch (error) {
        if (conn) await conn.rollback();
        console.error(`Erro ao confirmar triagem de ${type}:`, error);
        res.status(500).json({ message: 'Erro interno ao confirmar cadastro.' });
    } finally {
        if (conn) conn.release();
    }
});


// Busca reuniões confirmadas
router.get('/scheduled', protect, isAdmin, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        
        const query = `
            SELECT 
                a.id, 
                s.start_time,  
                a.meeting_link, 
                a.triagem_type, 
                a.triagem_id,
                a.status,
                COALESCE(p.nome_completo, pr.nome_completo, e.nome_empresa, 'Usuário Desconhecido') as user_name,
                COALESCE(p.email, pr.email, e.email) as user_email
            FROM triagem_appointments a
            LEFT JOIN admin_availability s ON a.availability_id = s.id
            LEFT JOIN triagem_pacientes p ON a.triagem_id = p.id AND a.triagem_type = 'pacientes'
            LEFT JOIN triagem_profissionais pr ON a.triagem_id = pr.id AND a.triagem_type = 'profissionais'
            LEFT JOIN triagem_empresas e ON a.triagem_id = e.id AND a.triagem_type = 'empresas'
            WHERE a.status = 'Confirmado'
            ORDER BY s.start_time ASC
        `;

        const rows = await conn.query(query);
        res.json(serializeBigInts(rows));

    } catch (error) {
        console.error("Erro ao buscar reuniões agendadas:", error);
        res.status(500).json({ message: 'Erro ao buscar reuniões agendadas.' });
    } finally {
        if (conn) conn.release();
    }
});

// ROTA PARA BUSCAR O HISTÓRICO DE TRIAGENS CONCLUÍDAS
router.get('/history', protect, isAdmin, async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        const history = await conn.query("SELECT * FROM historico_triagem ORDER BY data_migracao DESC");
        res.json(serializeBigInts(history));
    } catch (error) {
        console.error("Erro ao buscar histórico de triagem:", error);
        res.status(500).json({ message: 'Erro ao buscar histórico.' });
    } finally {
        if (conn) conn.release();
    }
});

module.exports = router;