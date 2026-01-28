// server/src/routes/notesRoutes.js
const express = require('express');
const pool = require('../config/db.js');
const { protect, isProfissional } = require('../middleware/authMiddleware.js');
const router = express.Router();

// ROTA PARA BUSCAR TODAS AS NOTAS DE UM PACIENTE ESPECÍFICO (ATUALIZADA)
// Permite que o novo responsável veja o histórico, mesmo que não tenha criado a nota.
router.get('/:patientId', protect, isProfissional, async (req, res) => {
    const { patientId } = req.params;
    const { userId: professionalUserId } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();
        const [profProfile] = await conn.query("SELECT id FROM professionals WHERE user_id = ?", [professionalUserId]);
        if (!profProfile) {
            return res.status(403).json({ message: 'Perfil de profissional não encontrado.' });
        }
        const professionalId = profProfile.id;

        // 1. VERIFICAÇÃO DE SEGURANÇA (VÍNCULO)
        // Verifica se o profissional é o Criador, o Responsável ATUAL ou tem Agendamentos (histórico) com o paciente
        const [link] = await conn.query(
            `SELECT p.id FROM patients p
             LEFT JOIN appointments a ON a.patient_id = p.id
             WHERE p.id = ? AND (
                p.created_by_professional_id = ? 
                OR p.responsible_professional_id = ? 
                OR a.professional_id = ?
             )
             LIMIT 1`,
            [patientId, professionalId, professionalId, professionalId]
        );

        if (!link) {
            return res.status(403).json({ message: "Você não tem permissão para acessar as notas deste paciente." });
        }

        // 2. BUSCA AS NOTAS (Histórico Completo)
        // Removemos o filtro "AND professional_id = ?" para permitir ver o histórico de outros
        // Fazemos JOIN com professionals para mostrar QUEM escreveu a nota antiga
        const notes = await conn.query(
            `SELECT 
                n.*,
                p.nome as professional_name 
             FROM session_notes n
             LEFT JOIN professionals p ON n.professional_id = p.id
             WHERE n.patient_id = ? 
             ORDER BY n.created_at DESC`,
            [patientId]
        );

        res.json(notes);
    } catch (error) {
        console.error("Erro ao buscar notas:", error);
        res.status(500).json({ message: 'Erro ao buscar notas do paciente.' });
    } finally {
        if (conn) conn.release();
    }
});

// ROTA PARA CRIAR UMA NOVA NOTA
router.post('/', protect, isProfissional, async (req, res) => {
    const { patient_id, note_content } = req.body;
    const { userId: professionalUserId } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();
        const [profProfile] = await conn.query("SELECT id FROM professionals WHERE user_id = ?", [professionalUserId]);
        if (!profProfile) {
            return res.status(403).json({ message: 'Perfil de profissional não encontrado.' });
        }
        const professionalId = profProfile.id;

        // Opcional: Você pode adicionar aqui a mesma verificação de vínculo do GET 
        // para impedir que um profissional crie notas para um paciente que não é dele.

        const result = await conn.query(
            "INSERT INTO session_notes (professional_id, patient_id, note_content) VALUES (?, ?, ?)",
            [professionalId, patient_id, note_content]
        );

        const insertId = Array.isArray(result) ? result[0].insertId : result.insertId;
        const [newNote] = await conn.query("SELECT * FROM session_notes WHERE id = ?", [insertId]);

        res.status(201).json(newNote);
    } catch (error) {
        console.error("Erro ao criar nota:", error);
        res.status(500).json({ message: 'Erro ao criar nota.' });
    } finally {
        if (conn) conn.release();
    }
});

// ROTA PARA ATUALIZAR UMA NOTA (Mantém restrição de edição apenas para o dono da nota)
router.put('/:noteId', protect, isProfissional, async (req, res) => {
    const { noteId } = req.params;
    const { note_content } = req.body;
    const { userId: professionalUserId } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();
        const [profProfile] = await conn.query("SELECT id FROM professionals WHERE user_id = ?", [professionalUserId]);
        if (!profProfile) return res.status(403).json({ message: 'Perfil de profissional não encontrado.' });

        const professionalId = profProfile.id;

        // Verifica se a nota pertence ao profissional logado
        const [note] = await conn.query("SELECT * FROM session_notes WHERE id = ? AND professional_id = ?", [noteId, professionalId]);
        if (!note) {
            return res.status(404).json({ message: 'Nota não encontrada ou você não tem permissão para editá-la.' });
        }

        const createdAt = new Date(note.created_at);
        const now = new Date();
        const diffDays = Math.ceil(Math.abs(now - createdAt) / (1000 * 60 * 60 * 24));

        if (diffDays > 15) {
            return res.status(403).json({ message: 'Não é possível editar notas com mais de 15 dias.' });
        }

        await conn.query("UPDATE session_notes SET note_content = ? WHERE id = ?", [note_content, noteId]);
        const [updatedNote] = await conn.query("SELECT * FROM session_notes WHERE id = ?", [noteId]);

        res.json(updatedNote);
    } catch (error) {
        console.error("Erro ao atualizar nota:", error);
        res.status(500).json({ message: 'Erro ao atualizar nota.' });
    } finally {
        if (conn) conn.release();
    }
});

// ROTA PARA DELETAR UMA NOTA (Mantém restrição de deleção apenas para o dono da nota)
router.delete('/:noteId', protect, isProfissional, async (req, res) => {
    const { noteId } = req.params;
    const { userId: professionalUserId } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();
        const [profProfile] = await conn.query("SELECT id FROM professionals WHERE user_id = ?", [professionalUserId]);
        if (!profProfile) return res.status(403).json({ message: 'Perfil de profissional não encontrado.' });

        const professionalId = profProfile.id;

        const result = await conn.query(
            "DELETE FROM session_notes WHERE id = ? AND professional_id = ?", 
            [noteId, professionalId]
        );

        if (result.affectedRows === 0) {
             return res.status(404).json({ message: 'Nota não encontrada ou você não tem permissão para deletá-la.' });
        }

        res.json({ message: 'Nota deletada com sucesso.' });
    } catch (error) {
        console.error("Erro ao deletar nota:", error);
        res.status(500).json({ message: 'Erro ao deletar nota.' });
    } finally {
        if (conn) conn.release();
    }
});

module.exports = router;