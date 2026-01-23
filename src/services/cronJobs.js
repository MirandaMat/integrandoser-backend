// server/src/services/cronJobs.js
const cron = require('node-cron');
const pool = require('../config/db');
const crypto = require('crypto');
const { sendAppointmentReminder } = require('../config/mailer');
const { sendWhatsAppReminder } = require('../config/whatsapp.js');

// Base URL of your frontend
const FRONTEND_URL = 'https://integrandoser.com.br' || 'http://localhost:5173';

const initScheduledJobs = () => {
    // Runs every hour to check for appointments happening in exactly 24 hours (roughly)
    cron.schedule('0 * * * *', async () => {
        console.log('[Cron] Checking for appointments to remind...');
        let conn;
        try {
            conn = await pool.getConnection();

            // Find appointments happening between 23h and 25h from now that haven't been confirmed yet
            // and don't have a token generated (avoid spamming)
            const query = `
                SELECT a.id, a.appointment_time, u.email, u.telefone, p.nome, a.professional_id
                FROM appointments a
                JOIN patients p ON a.patient_id = p.id
                JOIN users u ON p.user_id = u.id
                WHERE a.status = 'Agendada' 
                AND a.is_confirmed = FALSE
                AND a.confirmation_token IS NULL
                AND a.appointment_time BETWEEN NOW() + INTERVAL 23 HOUR AND NOW() + INTERVAL 25 HOUR
            `;

            const appointments = await conn.query(query);

            for (const app of appointments) {
                // Generate a unique token
                const token = crypto.randomBytes(32).toString('hex');
                
                // Save token to DB
                await conn.query('UPDATE appointments SET confirmation_token = ? WHERE id = ?', [token, app.id]);

                // Generate Links
                const confirmLink = `${FRONTEND_URL}/appointment/confirm/${token}`;
                const rescheduleLink = `${FRONTEND_URL}/appointment/reschedule/${token}`;

                // Send Email
                await sendAppointmentReminder(app.email, app.nome, app.appointment_time, confirmLink, rescheduleLink);
                
                // --- NOVO: Envia WhatsApp ---
                if (app.telefone) {
                    console.log(`[Cron] Enviando WhatsApp para ${app.nome}...`);
                    await sendWhatsAppReminder(
                        app.telefone,
                        app.nome,
                        app.appointment_time,
                        confirmLink, 
                        rescheduleLink
                    );
                }
            
            
            }

        } catch (error) {
            console.error('[Cron] Error processing reminders:', error);
        } finally {
            if (conn) conn.release();
        }
    });
};

module.exports = initScheduledJobs;