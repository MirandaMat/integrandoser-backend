// server/src/routes/notesRoutes.js
const express = require('express');
const pool = require('../config/db.js');
const { protect, isProfissional } = require('../middleware/authMiddleware.js');
const router = express.Router();

// --- FUNÇÃO AUXILIAR PARA CORRIGIR O ERRO DE BIGINT ---
const serializeBigInts = (data) => {
    if (typeof data === 'bigint') {
        return data.toString();
    }
    if (data instanceof Date) {
        return data;
    }
    if (Array.isArray(data)) {
        return data.map(item => serializeBigInts(item));
    }
    if (data === null || typeof data !== 'object') {
        return data;
    }
    const res = {};
    for (const key in data) {
        res[key] = serializeBigInts(data[key]);
    }
    return res;
};

// ROTA PARA BUSCAR TODAS AS NOTAS (COM REGRAS DE CONSENTIMENTO)
router.get('/:patientId', protect, isProfissional, async (req, res) => {
    const { patientId } = req.params;
    const { userId: professionalUserId } = req.user;
    let conn;
    try {
        conn = await pool.getConnection();
        const [profProfile] = await conn.query("SELECT id FROM professionals WHERE user_id = ?", [professionalUserId]);
        if (!profProfile) return res.status(403).json({ message: 'Perfil não encontrado.' });
        
        const professionalId = profProfile.id;

        // 1. Verify Basic Link
        const [link] = await conn.query(
            `SELECT p.id, p.notes_consent, p.previous_professional_id 
             FROM patients p
             LEFT JOIN appointments a ON a.patient_id = p.id
             WHERE p.id = ? AND (
                p.created_by_professional_id = ? 
                OR p.responsible_professional_id = ? 
                OR a.professional_id = ?
             ) LIMIT 1`,
            [patientId, professionalId, professionalId, professionalId]
        );

        if (!link) return res.status(403).json({ message: "Sem permissão de acesso." });

        const { notes_consent, previous_professional_id } = link;

        // 2. Fetch Notes with Logic
        // IF the note was created by another professional AND consent is NOT given -> Content is Hidden
        const notes = await conn.query(
            `SELECT 
                n.id, 
                n.created_at, 
                n.professional_id,
                p.nome as professional_name,
                (n.professional_id = ?) as is_owner,
                CASE 
                    WHEN n.professional_id = ? THEN n.note_content
                    WHEN ? = 1 THEN n.note_content 
                    ELSE 'CONTEÚDO BLOQUEADO: Aguardando autorização do autor anterior.' 
                END as note_content
             FROM session_notes n
             LEFT JOIN professionals p ON n.professional_id = p.id
             WHERE n.patient_id = ? 
             ORDER BY n.created_at DESC`,
            [professionalId, professionalId, notes_consent, patientId]
        );

        // AQUI ESTAVA O ERRO: Agora usamos serializeBigInts antes de enviar
        res.json(serializeBigInts(notes));

    } catch (error) {
        console.error("Erro ao buscar notas:", error);
        res.status(500).json({ message: 'Erro ao buscar notas.' });
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

        // Também serializamos aqui por garantia
        res.status(201).json(serializeBigInts(newNote));
    } catch (error) {
        console.error("Erro ao criar nota:", error);
        res.status(500).json({ message: 'Erro ao criar nota.' });
    } finally {
        if (conn) conn.release();
    }
});

// ROTA PARA ATUALIZAR UMA NOTA
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

        res.json(serializeBigInts(updatedNote));
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