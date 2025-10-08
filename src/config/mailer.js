// server/src/config/mailer.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const sendWelcomeEmail = async (to, tempPassword) => {
    const mailOptions = {
        from: `"IntegrandoSer" <${process.env.EMAIL_USER}>`,
        to: to,
        subject: 'Bem-vindo(a) ao IntegrandoSer! Complete seu cadastro.',
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6;">
                <h2>Olá e seja bem-vindo(a) ao IntegrandoSer!</h2>
                <p>Seu cadastro inicial foi aprovado e sua conta foi criada com sucesso.</p>
                <p>Para seu primeiro acesso, utilize as seguintes credenciais:</p>
                <ul>
                    <li><strong>Email:</strong> ${to}</li>
                    <li><strong>Senha Temporária:</strong> ${tempPassword}</li>
                </ul>
                <p>Você será solicitado(a) a completar seu perfil e definir uma nova senha no seu primeiro login.</p>
                <p>Acesse a plataforma em: <a href="http://localhost:5173/login">Fazer Login</a></p>
                <br>
                <p>Atenciosamente,</p>
                <p><strong>Equipe IntegrandoSer</strong></p>
            </div>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`E-mail de boas-vindas enviado para ${to}`);
    } catch (error) {
        console.error(`Erro ao enviar e-mail para ${to}:`, error);
    }
};

const sendSchedulingEmail = async (to, name, scheduleLink) => {
    const mailOptions = {
        from: `"IntegrandoSer" <${process.env.EMAIL_USER}>`,
        to: to,
        subject: 'Convite para Agendamento de Entrevista - Terapia Para Todos',
        html: `
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
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`E-mail de agendamento enviado para ${to}`);
    } catch (error) {
        console.error(`Erro ao enviar e-mail de agendamento para ${to}:`, error);
        // Lança o erro para que a rota da API possa capturá-lo
        throw new Error('Falha ao enviar o e-mail de agendamento.');
    }
};

const sendConfirmationEmail = async (to, name, appointmentTime, meetingLink) => {
    const formattedTime = new Date(appointmentTime).toLocaleString('pt-BR', {
        dateStyle: 'full',
        timeStyle: 'short'
    });

    const mailOptions = {
        from: `"IntegrandoSer" <${process.env.EMAIL_USER}>`,
        to: to,
        subject: '✅ Agendamento Confirmado - Entrevista Terapia Para Todos',
        html: `
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
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`E-mail de confirmação enviado para ${to}`);
    } catch (error) {
        console.error(`Erro ao enviar e-mail de confirmação para ${to}:`, error);
        throw new Error('Falha ao enviar o e-mail de confirmação.');
    }
};


// FUNÇÃO PARA ENVIAR ATUALIZAÇÕES DE AGENDAMENTO
const sendUpdateEmail = async (to, name, appointmentTime, meetingLink) => {
    const formattedTime = new Date(appointmentTime).toLocaleString('pt-BR', {
        dateStyle: 'full',
        timeStyle: 'short'
    });

    const mailOptions = {
        from: `"IntegrandoSer" <${process.env.EMAIL_USER}>`,
        to: to,
        subject: '❗️ Atualização sobre seu Agendamento - Terapia Para Todos',
        html: `
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
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`E-mail de atualização enviado para ${to}`);
    } catch (error) {
        console.error(`Erro ao enviar e-mail de atualização para ${to}:`, error);
        throw new Error('Falha ao enviar o e-mail de atualização.');
    }
};

// E-mail para notificar o usuário sobre uma nova cobrança
const sendInvoiceNotificationEmail = async (recipientEmail, recipientName, creatorName, amount, dueDate, invoiceId, paymentLink) => {
    const formattedAmount = parseFloat(amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const formattedDate = new Date(dueDate).toLocaleDateString('pt-BR');

    const mailOptions = {
        from: `"IntegrandoSer" <${process.env.EMAIL_USER}>`,
        to: recipientEmail,
        subject: `Nova Cobrança Recebida - Fatura #${invoiceId}`,
        html: `
            <p>Olá, ${recipientName},</p>
            <p>Você recebeu uma nova cobrança de <strong>${creatorName}</strong> no valor de <strong>${formattedAmount}</strong> com vencimento em <strong>${formattedDate}</strong>.</p>
            <p>Para visualizar os detalhes e realizar o pagamento, por favor, acesse sua área financeira na plataforma.</p>
            <a href="${paymentLink}" style="display: inline-block; padding: 10px 20px; background-color: #8B5CF6; color: white; text-decoration: none; border-radius: 5px;">Acessar Minhas Finanças</a>
            <p>Atenciosamente,<br>Equipe IntegrandoSer</p>
        `,
    };
    await transporter.sendMail(mailOptions);
};

// E-mail para notificar o criador da fatura sobre o envio de um comprovante
const sendReceiptUploadNotificationEmail = async (recipientEmail, recipientName, uploaderName, invoiceId, approvalLink) => {
    const mailOptions = {
        from: `"IntegrandoSer" <${process.env.EMAIL_USER}>`,
        to: recipientEmail,
        subject: `Comprovante Recebido - Fatura #${invoiceId}`,
        html: `
            <p>Olá, ${recipientName},</p>
            <p>O usuário <strong>${uploaderName}</strong> enviou um comprovante de pagamento para a fatura <strong>#${invoiceId}</strong>.</p>
            <p>Por favor, acesse a área de gerenciamento de faturas para revisar e aprovar o pagamento.</p>
            <a href="${approvalLink}" style="display: inline-block; padding: 10px 20px; background-color: #10B981; color: white; text-decoration: none; border-radius: 5px;">Revisar Fatura</a>
            <p>Atenciosamente,<br>Equipe IntegrandoSer</p>
        `,
    };
    await transporter.sendMail(mailOptions);
};



module.exports = {
    sendWelcomeEmail,
    sendSchedulingEmail,
    sendConfirmationEmail,
    sendUpdateEmail,
    sendInvoiceNotificationEmail,
    sendReceiptUploadNotificationEmail
};
