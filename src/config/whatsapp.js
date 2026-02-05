// server/src/config/whatsapp.js
const axios = require('axios');

// Carrega variáveis de ambiente (Configuradas no Railway)
const WHATSAPP_TOKEN = process.env.WHATSAPP_API_TOKEN; 
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID; 
const API_URL = `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_ID}/messages`;

// Helper: Formata telefone (55 + DDD + Numero)
const formatPhoneNumber = (phone) => {
    let cleanPhone = phone.replace(/\D/g, ''); 
    if (cleanPhone.length === 10 || cleanPhone.length === 11) {
        cleanPhone = '55' + cleanPhone;
    }
    return cleanPhone;
};

// Helper
const sendTemplateMessage = async (to, templateName, components) => {
    if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
        console.warn("[WhatsApp] Variáveis de ambiente ausentes.");
        return;
    }

    try {
        const response = await axios.post(
            API_URL,
            {
                messaging_product: "whatsapp",
                to: formatPhoneNumber(to),
                type: "template",
                template: {
                    name: templateName,
                    language: { code: "pt_BR" },
                    components: components
                }
            },
            {
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }
            }
        );
        console.log(`[WhatsApp] Template '${templateName}' enviado para ${to}.`);
        return response.data;
    } catch (error) {
        console.error(`[WhatsApp] Erro ao enviar:`, error.response ? error.response.data : error.message);
    }
};

// 1. Confirmação de Agendamento (Novo)
const sendWhatsAppConfirmation = async (phone, patientName, professionalName, appointmentTime) => {
    const formattedDate = new Date(appointmentTime).toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' });
    const components = [{
        type: "body",
        parameters: [
            { type: "text", text: patientName },       // {{1}}
            { type: "text", text: professionalName },  // {{2}}
            { type: "text", text: formattedDate }      // {{3}}
        ]
    }];
    await sendTemplateMessage(phone, "appointment_confirmation", components);
};

// 2. Lembrete 24h
const sendWhatsAppReminder = async (phone, patientName, appointmentTime, confirmLink, rescheduleLink) => {
    const formattedDate = new Date(appointmentTime).toLocaleString('pt-BR', { weekday: 'long', hour: '2-digit', minute: '2-digit' });
    const components = [{
        type: "body",
        parameters: [
            { type: "text", text: patientName },   // {{1}}
            { type: "text", text: formattedDate }, // {{2}}
            { type: "text", text: confirmLink },   // {{3}}
            { type: "text", text: rescheduleLink } // {{4}}
        ]
    }];
    await sendTemplateMessage(phone, "appointment_reminder", components);
};

// 3. Reagendamento
const sendWhatsAppRescheduled = async (phone, patientName, professionalName, newAppointmentTime) => {
    const formattedDate = new Date(newAppointmentTime).toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' });
    const components = [{
        type: "body",
        parameters: [
            { type: "text", text: patientName },       // {{1}}
            { type: "text", text: professionalName },  // {{2}}
            { type: "text", text: formattedDate }      // {{3}}
        ]
    }];
    await sendTemplateMessage(phone, "appointment_reschedule", components);
};

module.exports = { sendWhatsAppConfirmation, sendWhatsAppReminder, sendWhatsAppRescheduled };