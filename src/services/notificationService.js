// server/src/services/notificationService.js
const pool = require('../config/db.js');

// Função auxiliar para converter BigInt para String
const serializeBigInts = (data) => {
    if (typeof data === 'bigint') return data.toString();
    if (data instanceof Date) return data;
    if (data === null || typeof data !== 'object') return data;
    if (Array.isArray(data)) return data.map(item => serializeBigInts(item));
    const newObj = {};
    for (const key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
            newObj[key] = serializeBigInts(data[key]);
        }
    }
    return newObj;
};

// Função auxiliar para mapear ROLE -> Prefixo de URL
const getRoleBasedUrlPrefix = (role) => {
    switch (role) {
        case 'ADM': return '/admin';
        case 'PROFISSIONAL': return '/professional';
        case 'PACIENTE': return '/paciente';
        case 'EMPRESA': return '/empresa';
        default: return '';
    }
};

const createNotification = async (req, userId, type, message) => {
    let conn;
    try {
        conn = await pool.getConnection();

        // 1. Buscar o papel (role) do usuário
        const [user] = await conn.query(
            "SELECT r.name as role FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?",
            [userId]
        );

        if (!user) {
            console.error(`[Notificação] Falha: Usuário com ID ${userId} não encontrado.`);
            return;
        }

        const rolePrefix = getRoleBasedUrlPrefix(user.role);
        let path = '';

        // 2. Determinar o caminho com base no TIPO da notificação
        switch (type) {
            case 'new_triage':
            path = '/triagem';
            break;
            case 'new_message':
                path = '/messages';
                break;
            case 'new_invoice':
            case 'payment_received':
                path = '/financeiro';
                break;
            case 'new_appointment':
            case 'appointment_rescheduled':
                path = '/agenda';
                break;
            case 'profile_update': // Notificação genérica de perfil/conta
                path = '/profile';
                break;
            default:
                path = '/dashboard';
        }

        const generatedUrl = `${rolePrefix}${path}`;

        // 3. Inserir a notificação no banco
        const result = await conn.query(
            'INSERT INTO notifications (user_id, type, message, related_url) VALUES (?, ?, ?, ?)',
            [userId, type, message, generatedUrl]
        );
        const newNotificationId = Array.isArray(result) ? result[0].insertId : result.insertId;
        if (!newNotificationId) throw new Error("Não foi possível obter o ID da nova notificação.");

        const [newNotification] = await conn.query('SELECT * FROM notifications WHERE id = ?', [newNotificationId]);

        // 4. Emitir via Socket.IO (LÓGICA CORRIGIDA)
        const io = req.app.get('io');
        const getUserSocket = req.app.get('getUserSocket');

        if (!io || !getUserSocket) {
            console.error('[Notification Service] ERRO CRÍTICO: Instância do io ou getUserSocket não encontrada via app.set. Socket não pode ser emitido.');
            // A notificação foi salva no DB, mas não pode ser emitida em tempo real.
            return; 
        }

        const userSocketId = getUserSocket(userId);

        console.log(`[Notification Service] Preparando para emitir notificação tipo '${type}' para User ID ${userId}. Socket ID encontrado: ${userSocketId || 'Nenhum (usuário offline?)'}`);

        if (userSocketId && newNotification) {
            // Este é o ÚNICO local que emite o socket
            const notificationData = serializeBigInts(newNotification);
            io.to(userSocketId).emit('newNotification', notificationData);
            console.log(`[Notification Service] Evento 'newNotification' emitido com SUCESSO para socket ${userSocketId}. Dados:`, JSON.stringify(notificationData));
        
        } else if (newNotification) {
            // Se o usuário está offline, apenas logamos
            console.warn(`[Notification Service] Nenhum socket ativo encontrado para User ID ${userId}. Notificação ID ${newNotification.id} salva no DB, mas não enviada em tempo real.`);
        }

    } catch (error) {
        console.error(`Falha ao criar notificação para o usuário ${userId}:`, error);
    } finally {
        if (conn) conn.release();
    }
};

module.exports = { createNotification, getRoleBasedUrlPrefix };