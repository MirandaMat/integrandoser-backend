// server/src/config/mailer.js
// const nodemailer = require('nodemailer'); // <--- Removido Nodemailer
const { Resend } = require('resend'); // <--- Importado Resend

// Inicialize o Resend com a chave de API do ambiente
const resend = new Resend(process.env.RESEND_API_KEY);
// Use o email verificado configurado nas variáveis de ambiente
const fromEmail = process.env.EMAIL_FROM_ADDRESS;

// Verificação inicial (opcional, mas bom para debug)
if (!process.env.RESEND_API_KEY) {
    console.warn("[Mailer Config - Resend] AVISO: RESEND_API_KEY não está definida nas variáveis de ambiente.");
}
if (!fromEmail) {
    console.warn("[Mailer Config - Resend] AVISO: EMAIL_FROM_ADDRESS não está definida. Certifique-se de usar um domínio verificado no Resend.");
}

// --- Funções de Envio Adaptadas para Resend ---

const sendWelcomeEmail = async (to, tempPassword) => {
    const subject = 'Bem-vindo(a) ao IntegrandoSer! Complete seu cadastro.';
    const html = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6;">
            <h2>Olá e seja bem-vindo(a) ao IntegrandoSer!</h2>
            <p>Seu cadastro inicial foi aprovado e sua conta foi criada com sucesso.</p>
            <p>Para seu primeiro acesso, utilize as seguintes credenciais:</p>
            <ul>
                <li><strong>Email:</strong> ${to}</li>
                <li><strong>Senha Temporária:</strong> ${tempPassword}</li>
            </ul>
            <p>Você será solicitado(a) a completar seu perfil e definir uma nova senha no seu primeiro login.</p>
            <p>Acesse a plataforma em: <a href="https://integrandoser.com.br/login">Fazer Login</a></p>
            <br>
            <p>Atenciosamente,</p>
            <p><strong>Equipe IntegrandoSer</strong></p>
        </div>
    `;

    try {
        const { data, error } = await resend.emails.send({
            from: `IntegrandoSer <${fromEmail}>`, // Remetente verificado
            to: [to], // Resend espera um array
            subject: subject,
            html: html,
        });

        if (error) {
            console.error(`Erro ao enviar e-mail de boas-vindas (Resend) para ${to}:`, error);
            throw error; // Lança o erro para a rota capturar
        }

        console.log(`E-mail de boas-vindas enviado (Resend) para ${to}. ID: ${data?.id || 'N/A'}`); // Adicionado '?' para segurança

    } catch (error) {
        console.error(`Falha catastrófica ao tentar enviar e-mail de boas-vindas (Resend) para ${to}:`, error);
        throw error; // Lança o erro para a camada superior
    }
};

const sendSchedulingEmail = async (to, name, scheduleLink) => {
    const subject = 'Convite para Agendamento de Entrevista - Terapia Para Todos';
    const html = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6;">
            <h2>Olá, ${name}!</h2>
            <p>Recebemos sua inscrição para o projeto Terapia Para Todos e gostaríamos de agendar uma entrevista inicial com você.</p>
            <p>Por favor, clique no link abaixo para ver nossos horários disponíveis e escolher o que for melhor para você.</p>
            <p style="text-align: center; margin: 20px 0;">
                <a href="${scheduleLink}" style="background-color: #8B5CF6; color: white; padding: 12px 20px; text-decoration: none; border-radius: 8px; font-weight: bold;">
                    Escolher Horário
                </a>
            </p>
            <p>O link é válido para os próximos 2 meses. Caso tenha qualquer dificuldade, por favor, entre em contato conosco.</p>
            <br>
            <p>Atenciosamente,</p>
            <p><strong>Equipe IntegrandoSer</strong></p>
        </div>
    `;
    try {
        const { data, error } = await resend.emails.send({
            from: `IntegrandoSer <${fromEmail}>`,
            to: [to],
            subject: subject,
            html: html,
        });
        if (error) {
            console.error(`Erro ao enviar e-mail de agendamento (Resend) para ${to}:`, error);
            throw error;
        }
        console.log(`E-mail de agendamento enviado (Resend) para ${to}. ID: ${data?.id || 'N/A'}`);
    } catch (error) {
        console.error(`Falha catastrófica ao tentar enviar e-mail de agendamento (Resend) para ${to}:`, error);
        throw new Error('Falha ao enviar o e-mail de agendamento.');
    }
};

const sendConfirmationEmail = async (to, name, appointmentTime, meetingLink) => {
    const formattedTime = new Date(appointmentTime).toLocaleString('pt-BR', {
        dateStyle: 'full',
        timeStyle: 'short'
    });
    const subject = '✅ Agendamento Confirmado - Entrevista Terapia Para Todos';
    const html = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6;">
            <h2>Olá, ${name}!</h2>
            <p>Sua entrevista inicial para o projeto Terapia Para Todos foi <strong>confirmada com sucesso!</strong></p>
            <p><strong>Detalhes do Agendamento:</strong></p>
            <ul>
                <li><strong>Data e Hora:</strong> ${formattedTime}</li>
                <li><strong>Link da Reunião:</strong> <a href="${meetingLink}" target="_blank">${meetingLink}</a></li>
            </ul>
            <p>Por favor, seja pontual. Se precisar reagendar, entre em contato conosco com antecedência.</p>
            <br>
            <p>Atenciosamente,</p>
            <p><strong>Equipe IntegrandoSer</strong></p>
        </div>
    `;

    try {
        const { data, error } = await resend.emails.send({
            from: `IntegrandoSer <${fromEmail}>`,
            to: [to],
            subject: subject,
            html: html,
        });
        if (error) {
            console.error(`Erro ao enviar e-mail de confirmação (Resend) para ${to}:`, error);
            throw error;
        }
        console.log(`E-mail de confirmação enviado (Resend) para ${to}. ID: ${data?.id || 'N/A'}`);
    } catch (error) {
        console.error(`Falha catastrófica ao tentar enviar e-mail de confirmação (Resend) para ${to}:`, error);
        throw new Error('Falha ao enviar o e-mail de confirmação.');
    }
};

const sendUpdateEmail = async (to, name, appointmentTime, meetingLink) => {
    const formattedTime = new Date(appointmentTime).toLocaleString('pt-BR', {
        dateStyle: 'full',
        timeStyle: 'short'
    });
    const subject = '❗️ Atualização sobre seu Agendamento - Terapia Para Todos';
    const html = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6;">
            <h2>Olá, ${name}!</h2>
            <p>Houve uma atualização nos detalhes da sua entrevista inicial. Por favor, anote as novas informações:</p>
            <p><strong>Novos Detalhes do Agendamento:</strong></p>
            <ul>
                <li><strong>Data e Hora:</strong> ${formattedTime}</li>
                <li><strong>Link da Reunião:</strong> <a href="${meetingLink}" target="_blank">${meetingLink}</a></li>
            </ul>
            <p>Se tiver qualquer dúvida, entre em contato conosco.</p>
            <br>
            <p>Atenciosamente,</p>
            <p><strong>Equipe IntegrandoSer</strong></p>
        </div>
    `;

    try {
        const { data, error } = await resend.emails.send({
            from: `IntegrandoSer <${fromEmail}>`,
            to: [to],
            subject: subject,
            html: html,
        });
        if (error) {
            console.error(`Erro ao enviar e-mail de atualização (Resend) para ${to}:`, error);
            throw error;
        }
        console.log(`E-mail de atualização enviado (Resend) para ${to}. ID: ${data?.id || 'N/A'}`);
    } catch (error) {
        console.error(`Falha catastrófica ao tentar enviar e-mail de atualização (Resend) para ${to}:`, error);
        throw new Error('Falha ao enviar o e-mail de atualização.');
    }
};

const sendInvoiceNotificationEmail = async (recipientEmail, recipientName, creatorName, amount, dueDate, invoiceId, paymentLink) => {
    const formattedAmount = parseFloat(amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    // Corrigido: Assegura que dueDate é um objeto Date antes de formatar
    const formattedDate = dueDate instanceof Date ? dueDate.toLocaleDateString('pt-BR') : new Date(dueDate).toLocaleDateString('pt-BR');
    const subject = `Nova Cobrança Recebida - Fatura #${invoiceId}`;
    const html = `
        <p>Olá, ${recipientName},</p>
        <p>Você recebeu uma nova cobrança de <strong>${creatorName}</strong> no valor de <strong>${formattedAmount}</strong> com vencimento em <strong>${formattedDate}</strong>.</p>
        <p>Para visualizar os detalhes e realizar o pagamento, por favor, acesse sua área financeira na plataforma.</p>
        <a href="${paymentLink}" style="display: inline-block; padding: 10px 20px; background-color: #8B5CF6; color: white; text-decoration: none; border-radius: 5px;">Acessar Minhas Finanças</a>
        <p>Atenciosamente,<br>Equipe IntegrandoSer</p>
    `;

    try {
        const { data, error } = await resend.emails.send({
            from: `IntegrandoSer <${fromEmail}>`,
            to: [recipientEmail],
            subject: subject,
            html: html,
        });
        if (error) {
            console.error(`Erro ao enviar e-mail de notificação de fatura (Resend) para ${recipientEmail}:`, error);
            throw error;
        }
        console.log(`E-mail de notificação de fatura enviado (Resend) para ${recipientEmail}. ID: ${data?.id || 'N/A'}`);
    } catch (error) {
        console.error(`Falha catastrófica ao tentar enviar e-mail de notificação de fatura (Resend) para ${recipientEmail}:`, error);
        throw error; // Re-lança para a rota tratar
    }
};

const sendReceiptUploadNotificationEmail = async (recipientEmail, recipientName, uploaderName, invoiceId, approvalLink) => {
    const subject = `Comprovante Recebido - Fatura #${invoiceId}`;
    const html = `
        <p>Olá, ${recipientName},</p>
        <p>O usuário <strong>${uploaderName}</strong> enviou um comprovante de pagamento para a fatura <strong>#${invoiceId}</strong>.</p>
        <p>Por favor, acesse a área de gerenciamento de faturas para revisar e aprovar o pagamento.</p>
        <a href="${approvalLink}" style="display: inline-block; padding: 10px 20px; background-color: #10B981; color: white; text-decoration: none; border-radius: 5px;">Revisar Fatura</a>
        <p>Atenciosamente,<br>Equipe IntegrandoSer</p>
    `;

    try {
        const { data, error } = await resend.emails.send({
            from: `IntegrandoSer <${fromEmail}>`,
            to: [recipientEmail],
            subject: subject,
            html: html,
        });
        if (error) {
            console.error(`Erro ao enviar e-mail de notificação de comprovante (Resend) para ${recipientEmail}:`, error);
            throw error;
        }
        console.log(`E-mail de notificação de comprovante enviado (Resend) para ${recipientEmail}. ID: ${data?.id || 'N/A'}`);
    } catch (error) {
        console.error(`Falha catastrófica ao tentar enviar e-mail de notificação de comprovante (Resend) para ${recipientEmail}:`, error);
        throw error;
    }
};

// Exporta todas as funções adaptadas
module.exports = {
    sendWelcomeEmail,
    sendSchedulingEmail,
    sendConfirmationEmail, // Agora adaptada
    sendUpdateEmail,       // Agora adaptada
    sendInvoiceNotificationEmail,
    sendReceiptUploadNotificationEmail
};