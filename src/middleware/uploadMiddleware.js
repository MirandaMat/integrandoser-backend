// server/src/middleware/uploadMiddleware.js
const multer = require('multer');
const { storageEngine } = require('multer-google-storage');
const path = require('path');

// --- 1. Configuração do Google Cloud Storage ---
// Verifique se as variáveis de ambiente essenciais existem
if (!process.env.GCS_BUCKET_NAME || !process.env.GCS_PROJECT_ID || !process.env.GCS_CLIENT_EMAIL || !process.env.GCS_PRIVATE_KEY) {
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.error('[GCS_CONFIG] Variáveis de ambiente do GCS não estão configuradas!');
    console.error('Verifique GCS_BUCKET_NAME, GCS_PROJECT_ID, GCS_CLIENT_EMAIL, e GCS_PRIVATE_KEY.');
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    throw new Error('Variáveis de ambiente do Google Cloud Storage ausentes.');
}

// Formata a chave privada (variáveis de ambiente no Railway podem quebrar as linhas)
// ADICIONADO .trim() para remover quebras de linha extras no início ou fim
const gcsPrivateKey = process.env.GCS_PRIVATE_KEY.replace(/\\n/g, '\n').trim(); // <<< MUDANÇA AQUI

// --- !!!!! DEBUGGING LOGS (Pode remover depois que funcionar) !!!!! ---
console.log('--- [GCS DEBUG] VERIFICANDO VARIÁVEIS ---');
console.log(`[GCS DEBUG] GCS_PROJECT_ID: ${process.env.GCS_PROJECT_ID}`);
console.log(`[GCS DEBUG] GCS_CLIENT_EMAIL: ${process.env.GCS_CLIENT_EMAIL}`);
console.log(`[GCS DEBUG] GCS_BUCKET_NAME: ${process.env.GCS_BUCKET_NAME}`);
console.log(`[GCS DEBUG] gcsPrivateKey (Formatada, Inicia com '-----BEGIN...'): ${gcsPrivateKey.startsWith('-----BEGIN PRIVATE KEY-----')}`);
console.log(`[GCS DEBUG] gcsPrivateKey (Formatada, Termina com '...END PRIVATE KEY-----'): ${gcsPrivateKey.endsWith('-----END PRIVATE KEY-----')}`);
console.log('--- [GCS DEBUG] TENTANDO INICIAR storageEngine... ---');
// --- !!!!! FIM DO DEBUGGING !!!!! ---


const gcsStorage = storageEngine({
    bucket: process.env.GCS_BUCKET_NAME,
    projectId: process.env.GCS_PROJECT_ID,
    credentials: {
        client_email: process.env.GCS_CLIENT_EMAIL,
        private_key: gcsPrivateKey,
    },
    filename: (req, file, cb) => {
        // Gera um nome de arquivo único
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        cb(null, `${file.fieldname}-${uniqueSuffix}${extension}`);
    }
});

// --- 2. Lista de Mime Types Permitidos ---
const allowedMimeTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/webm', 'video/ogg',
    'video/quicktime',
    'application/pdf', 'application/msword', 
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

// --- 3. Instância do Multer usando o GCS Storage ---
const multerUpload = multer({
    storage: gcsStorage,
    fileFilter: (req, file, cb) => {
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Formato de arquivo não suportado!'), false);
        }
    },
    limits: { 
        fileSize: 1024 * 1024 * 50 // 50MB
    }
});

// --- 4. Função "Invólucro" para Erros (Inalterada) ---
const uploader = (multerInstance) => (req, res, next) => {
    multerInstance(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ message: 'Arquivo muito grande. O limite é de 50MB.' });
            }
            if (err.code === 'LIMIT_UNEXPECTED_FILE') {
                return res.status(400).json({ message: 'Formato de arquivo não suportado.' });
            }
        } else if (err) {
            console.error('[MULTER_ERROR]', err); 
            return res.status(500).json({ message: 'Ocorreu um erro no upload do arquivo.' });
        }
        next();
    });
};

// --- 5. Exportação dos Métodos (Inalterada) ---
module.exports = {
    single: (fieldName) => uploader(multerUpload.single(fieldName)),
    array: (fieldName, maxCount) => uploader(multerUpload.array(fieldName, maxCount)),
    fields: (fieldsConfig) => uploader(multerUpload.fields(fieldsConfig)),
};