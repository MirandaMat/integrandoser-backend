// server/src/middleware/uploadMiddleware.js
const multer = require('multer');
const { storageEngine } = require('multer-google-storage');
const { Storage } = require('@google-cloud/storage');
const path = require('path');

// --- 1. Verificação das Variáveis de Ambiente ---
if (!process.env.GCS_BUCKET_NAME || !process.env.GCS_PROJECT_ID || !process.env.GCS_CLIENT_EMAIL || !process.env.GCS_PRIVATE_KEY) {
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.error('[GCS_CONFIG] Variáveis de ambiente do GCS não estão configuradas!');
    console.error('Verifique GCS_BUCKET_NAME, GCS_PROJECT_ID, GCS_CLIENT_EMAIL, e GCS_PRIVATE_KEY.');
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    throw new Error('Variáveis de ambiente do Google Cloud Storage ausentes.');
}

// Formata a chave privada
const gcsPrivateKey = process.env.GCS_PRIVATE_KEY.replace(/\\n/g, '\n').trim();

// --- 2. Inicializa o Cliente Oficial do Google Cloud Storage ---
let storageClient;
try {
    console.log('[GCS DEBUG] Tentando inicializar o cliente @google-cloud/storage...');
    storageClient = new Storage({
        projectId: process.env.GCS_PROJECT_ID,
        credentials: {
            client_email: process.env.GCS_CLIENT_EMAIL,
            private_key: gcsPrivateKey,
        }
    });
    console.log('[GCS DEBUG] Cliente @google-cloud/storage inicializado com sucesso.');
} catch (error) {
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.error('[GCS_CONFIG] Erro ao inicializar o cliente @google-cloud/storage:', error);
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    throw new Error('Falha ao inicializar o cliente Google Cloud Storage.');
}


// --- 3. Configuração do Multer-Google-Storage usando o Cliente Inicializado ---
console.log('[GCS DEBUG] Tentando inicializar o storageEngine do Multer...');
const gcsStorage = storageEngine({
    storage: storageClient, // Passa o cliente inicializado
    projectId: process.env.GCS_PROJECT_ID, // <<< MUDANÇA AQUI: Passa o projectId redundantemente
    bucket: process.env.GCS_BUCKET_NAME,
    filename: (req, file, cb) => {
        // Gera um nome de arquivo único
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        cb(null, `${file.fieldname}-${uniqueSuffix}${extension}`);
    }
});
console.log('[GCS DEBUG] storageEngine do Multer inicializado.');


// --- 4. Lista de Mime Types Permitidos ---
const allowedMimeTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/webm', 'video/ogg',
    'video/quicktime',
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

// --- 5. Instância do Multer usando o GCS Storage ---
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

// --- 6. Função "Invólucro" para Erros ---
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

// --- 7. Exportação dos Métodos ---
module.exports = {
    single: (fieldName) => uploader(multerUpload.single(fieldName)),
    array: (fieldName, maxCount) => uploader(multerUpload.array(fieldName, maxCount)),
    fields: (fieldsConfig) => uploader(multerUpload.fields(fieldsConfig)),
};