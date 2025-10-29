// server/src/routes/profileRoutes.js
const express = require('express');
const pool = require('../config/db.js');
const bcrypt = require('bcryptjs');
const { protect } = require('../middleware/authMiddleware.js');
const upload = require('../middleware/uploadMiddleware.js');
const { createNotification } = require('../services/notificationService.js');
const router = express.Router();

// GET /api/profile/me 
router.get('/me', protect, async (req, res) => {
    const { userId, role } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();
        let tableName;
        switch (role) {
            case 'ADM': tableName = 'administrators'; break;
            case 'PROFISSIONAL': tableName = 'professionals'; break;
            case 'PACIENTE': tableName = 'patients'; break;
            case 'EMPRESA': tableName = 'companies'; break;
            default: return res.status(400).json({ message: 'Role inválida.' });
        }
        
        // CORREÇÃO CRÍTICA: Evita o conflito de 'id' duplicado
        const query = `
            SELECT u.email as email_login, u.first_login, p.* FROM users u 
            LEFT JOIN ${tableName} p ON u.id = p.user_id 
            WHERE u.id = ?
        `;
        
        
        const [profile] = await conn.query(query, [userId]);

        if (!profile) return res.status(404).json({ message: 'Perfil não encontrado.' });
        
        // Retorna o perfil combinado com a role
        res.json({ ...profile, role });

    } catch (error) {
        console.error("Erro ao buscar perfil 'me':", error);
        res.status(500).json({ message: 'Erro no servidor ao buscar perfil.' });
    } finally {
        if (conn) conn.release();
    }
});

// PUT /api/profile/me - Atualiza o perfil
router.put('/me', protect, upload.single('imagem_perfil'), async (req, res) => {
    const { userId, role } = req.user;
    const profileData = req.body;
    let conn;

    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();

        // 1. Atualiza a senha e a flag `first_login` se uma nova senha for fornecida
        if (profileData.password && profileData.password.length > 0) {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(profileData.password, salt);
            await conn.query(
                'UPDATE users SET password = ?, first_login = FALSE WHERE id = ?',
                [hashedPassword, userId]
            );
            delete profileData.password;
        }

        // 2. Adiciona a URL da imagem se um novo arquivo foi enviado
        if (req.file && req.file.gcsUrl) { // <<< Verifica se gcsUrl existe
            profileData.imagem_url = req.file.gcsUrl; // 
        } else if (req.file) {
             // Se req.file existe mas gcsUrl não, algo deu errado no upload GCS
             console.warn(`[PROFILE UPDATE] Arquivo ${req.file.originalname} recebido, mas URL GCS não encontrada.`);
             // Decide se quer lançar um erro ou apenas ignorar a imagem
        }

        // 3. Formata a data de nascimento para o formato do banco
        if (profileData.data_nascimento) {
            profileData.data_nascimento = new Date(profileData.data_nascimento).toISOString().split('T')[0];
        }

        // 4. Define a tabela e os campos permitidos para a role do usuário
        let tableName;
        let allowedFields;
        switch (role) {
            case 'ADM':
                tableName = 'administrators';
                allowedFields = ['nome', 'cpf', 'cnpj', 'data_nascimento', 'genero', 'telefone', 'email', 'endereco', 'profissao', 'imagem_url'];
                break;
            case 'PROFISSIONAL':
                tableName = 'professionals';
                allowedFields = ['nome', 'cpf', 'cnpj', 'data_nascimento', 'genero', 'endereco', 'cidade', 'telefone', 'email', 'profissao', 'level', 'modalidade_atendimento', 'especialidade', 'experiencia', 'abordagem', 'tipo_acompanhamento', 'imagem_url'];
                break;
            case 'PACIENTE':
                tableName = 'patients';
                allowedFields = ['nome', 'cpf', 'telefone', 'profissao', 'imagem_url', 'renda', 'preferencia_gen_atend', 'data_nascimento', 'genero', 'endereco', 'cidade', 'tipo_atendimento', 'modalidade_atendimento'];
                break;
            case 'EMPRESA':
                tableName = 'companies'; 
                allowedFields = ['nome_empresa', 'cnpj', 'num_colaboradores', 'nome_responsavel', 'cargo', 'telefone', 'email_contato', 'descricao', 'tipo_atendimento', 'frequencia', 'expectativa', 'imagem_url'];
                break;
            default: 
                throw new Error('Role de usuário inválida para atualização de perfil.');
        }

        // 5. Constrói a query de UPDATE do perfil dinamicamente
        const fieldsToUpdate = allowedFields.filter(field => profileData[field] !== undefined);
        
        if (fieldsToUpdate.length > 0) {
            const setClause = fieldsToUpdate.map(field => `${field} = ?`).join(', ');
            const values = fieldsToUpdate.map(field => profileData[field]);
            await conn.query(`UPDATE ${tableName} SET ${setClause} WHERE user_id = ?`, [...values, userId]);
        }
        
        await conn.commit();

        // Adicionar notificação de confirmação
        await createNotification(req, userId, 'profile_update', 'Seu perfil foi atualizado com sucesso.');

        res.json({ message: 'Perfil atualizado com sucesso!' });
        
    } catch (error) {
        if (conn) await conn.rollback();
        console.error("Erro ao atualizar perfil:", error);
        res.status(500).json({ message: 'Erro ao atualizar perfil.', details: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// PATCH token-pix do profissional
router.patch('/professional/pix-token', protect, async (req, res) => {
    const { userId, role } = req.user;
    const { pix_token } = req.body;
    if (role !== 'PROFISSIONAL') return res.status(403).json({ message: 'Acesso negado.' });
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query("UPDATE professionals SET pix_token = ? WHERE user_id = ?", [pix_token, userId]);
        res.json({ message: 'Token PIX atualizado!' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao atualizar token PIX.' });
    } finally {
        if (conn) conn.release();
    }
});

// PATCH token-pix do admin
router.patch('/admin/pix-token', protect, async (req, res) => {
    const { userId, role } = req.user;
    const { pix_token } = req.body;
    if (role !== 'ADM') return res.status(403).json({ message: 'Acesso negado.' });
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query("UPDATE administrators SET pix_token = ? WHERE user_id = ?", [pix_token, userId]);
        res.json({ message: 'Token PIX do admin atualizado!' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao atualizar token PIX do admin.' });
    } finally {
        if (conn) conn.release();
    }
});

/*
router.put('/me', protect, upload.single('imagem_perfil'), async (req, res) => {
    const { userId, role } = req.user;
    const profileData = req.body;
    let conn;

    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();

        // Se uma nova senha for enviada (fluxo de primeiro login),
        // atualiza a senha e a flag `first_login` na tabela `users`.
        if (profileData.password && profileData.password.length > 0) {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(profileData.password, salt);
            await conn.query(
                'UPDATE users SET password = ?, first_login = FALSE WHERE id = ?',
                [hashedPassword, userId]
            );
            delete profileData.password; // Remove para não ir para a tabela de perfil
        }

        if (req.file) {
            profileData.imagem_url = req.file.path.replace(/\\/g, "/");
        }

        // Formata a data de nascimento se ela existir, garantindo o formato AAAA-MM-DD
        if (profileData.data_nascimento) {
            profileData.data_nascimento = new Date(profileData.data_nascimento).toISOString().split('T')[0];
        }

        switch (role) {
            //Administrador:
            case 'ADM':
                tableName = 'administrators';
                const admFields = ['nome', 'cpf', 'cnpj', 'data_nascimento', 'genero', 
                    'telefone', 'email', 'endereco',  'profissao', 'imagem_url'];
                fieldsToUpdate = admFields.filter(field => profileData[field] !== undefined).map(field => `${field} = ?`).join(', ');
                values = admFields.filter(field => profileData[field] !== undefined).map(field => profileData[field]);
                break;
            // PROFISSIONAL:
            case 'PROFISSIONAL':
                tableName = 'professionals';
                const proFields = ['nome', 'cpf', 'cnpj', 'data_nascimento', 'genero', 'endereco', 'cidade',
                    'telefone', 'email', 'profissao', 'modalidade_atendimento', 'especialidade', 
                    'imagem_url', 'experiencia','abordagem',  'tipo_acompanhamento'];
                fieldsToUpdate = proFields.filter(field => profileData[field] !== undefined).map(field => `${field} = ?`).join(', ');
                values = proFields.filter(field => profileData[field] !== undefined).map(field => profileData[field]);
                break;
            // PACIENTE:
            case 'PACIENTE':
                tableName = 'patients';
                const pacFields = ['nome', 'cpf', 'telefone', 'profissao', 'imagem_url', 'renda', 'preferencia_gen_atend',
                    'data_nascimento', 'genero', 'endereco', 'cidade', 'tipo_atendimento', 'modalidade_atendimento'];
                fieldsToUpdate = pacFields.filter(field => profileData[field] !== undefined).map(field => `${field} = ?`).join(', ');
                values = pacFields.filter(field => profileData[field] !== undefined).map(field => profileData[field]);
                break;
            // EMPRESA:
            case 'EMPRESA':
                tableName = 'companies';
                const empFields = ['nome_empresa', 'cnpj', 'num_colaboradores', 'nome_responsavel', 'cargo', 'telefone', 
                    'email_contato', 'descricao', 'tipo_atendimento', 'frequencia', 'expectativa', 'imagem_url'];
                fieldsToUpdate = empFields.filter(field => profileData[field] !== undefined).map(field => `${field} = ?`).join(', ');
                values = empFields.filter(field => profileData[field] !== undefined).map(field => profileData[field]);
                break;
            default:
                return res.status(400).json({ message: 'Papel de usuário inválido para atualização.' });
        }
        
        // Constrói a query de UPDATE do perfil dinamicamente
        const fieldsToUpdate = Object.keys(profileData);
        if (fieldsToUpdate.length > 0) {
            const setClause = fieldsToUpdate.map(field => `${field} = ?`).join(', ');
            const values = fieldsToUpdate.map(field => profileData[field]);

            await conn.query(`UPDATE ${tableName} SET ${setClause} WHERE user_id = ?`, [...values, userId]);
        }
        
        await conn.commit();
        res.json({ message: 'Perfil atualizado com sucesso!' });
        
    } catch (error) {
        if (conn) await conn.rollback();
        console.error("Erro ao atualizar perfil:", error);
        res.status(500).json({ message: 'Erro ao atualizar perfil.', details: error.message });
    } finally {
        if (conn) conn.release();
    }
});*/

module.exports = router;