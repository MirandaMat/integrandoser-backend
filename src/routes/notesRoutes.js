// routes/notesRoutes.js
const express = require('express');
const pool = require('../config/db.js');
const { protect, isProfissional } = require('../middleware/authMiddleware.js');
const router = express.Router();

// ROTA PARA BUSCAR TODAS AS NOTAS DE UM PACIENTE ESPECÍFICO
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

        const notes = await conn.query(
            "SELECT * FROM session_notes WHERE patient_id = ? AND professional_id = ? ORDER BY created_at DESC",
            [patientId, professionalId]
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

// ROTA PARA ATUALIZAR UMA NOTA (COM REGRA DE 15 DIAS)
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

        // Primeiro, buscar a nota para verificar a data e a posse
        const [note] = await conn.query("SELECT * FROM session_notes WHERE id = ? AND professional_id = ?", [noteId, professionalId]);
        if (!note) {
            return res.status(404).json({ message: 'Nota não encontrada ou você não tem permissão para editá-la.' });
        }

        // Aplicar a regra de 15 dias
        const createdAt = new Date(note.created_at);
        const now = new Date();
        const diffTime = Math.abs(now - createdAt);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

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

// ROTA PARA DELETAR UMA NOTA
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