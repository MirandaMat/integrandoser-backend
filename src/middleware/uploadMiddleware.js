// server/src/middleware/uploadMiddleware.js
const multer = require('multer');
const MulterGoogleStorage = require('multer-google-storage');
const path = require('path');
// REMOVIDO: const { Storage } = require('@google-cloud/storage');

// Manter os logs para ter certeza
console.log("--- DEBUG GCS Credentials (ANTES) ---");
console.log("process.env.GCS_PROJECT_ID:", process.env.GCS_PROJECT_ID ? typeof process.env.GCS_PROJECT_ID : 'UNDEFINED');
console.log("process.env.GCS_CLIENT_EMAIL:", process.env.GCS_CLIENT_EMAIL ? typeof process.env.GCS_CLIENT_EMAIL : 'UNDEFINED');
console.log("process.env.GCS_PRIVATE_KEY:", process.env.GCS_PRIVATE_KEY ? 'DEFINIDO (parcial): ' + process.env.GCS_PRIVATE_KEY.substring(0, 30) + "..." : '*** UNDEFINED ***');
console.log("process.env.GCS_BUCKET_NAME:", process.env.GCS_BUCKET_NAME ? typeof process.env.GCS_BUCKET_NAME : 'UNDEFINED');
// ===================================================================

const rawPrivateKey = process.env.GCS_PRIVATE_KEY || '';
const privateKey = rawPrivateKey.replace(/\\n/g, '\n');

// Manter os logs para ter certeza
console.log("--- DEBUG GCS Credentials (DEPOIS format) ---");
const projectIdValue = process.env.GCS_PROJECT_ID;
const clientEmailValue = process.env.GCS_CLIENT_EMAIL;
const bucketNameValue = process.env.GCS_BUCKET_NAME;

console.log("projectIdValue:", projectIdValue ? typeof projectIdValue : 'UNDEFINED');
console.log("clientEmailValue:", clientEmailValue ? typeof clientEmailValue : 'UNDEFINED');
console.log("privateKey (formatada):", privateKey ? `DEFINIDO (len: ${privateKey.length}, ends: ...${privateKey.slice(-30)})` : '*** VAZIA/UNDEFINED ***');
console.log("bucketNameValue:", bucketNameValue ? typeof bucketNameValue : 'UNDEFINED');

// Manter a verificação
if (!projectIdValue || typeof projectIdValue !== 'string' ||
    !clientEmailValue || typeof clientEmailValue !== 'string' ||
    !privateKey || typeof privateKey !== 'string' || privateKey.length < 50 ||
    !bucketNameValue || typeof bucketNameValue !== 'string') {
     console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
     console.error("!!! ERRO CRÍTICO: UMA OU MAIS CREDENCIAIS GCS ESTÃO INVÁLIDAS OU AUSENTES !!!");
     console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
     throw new Error("Credenciais GCS ausentes ou inválidas detectadas ANTES de chamar storageEngine.");
}
console.log("--- Todas as credenciais parecem válidas. Chamando storageEngine (sem cliente manual)... ---");
// ===================================================================

// Lista de tipos de arquivo permitidos
const allowedMimeTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/webm', 'video/ogg',
    'video/quicktime',
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

// --- Voltando à configuração com projectId e credentials aninhados ---
const storage = MulterGoogleStorage.storageEngine({
    projectId: projectIdValue,
    bucket: bucketNameValue,

    credentials: {
        client_email: clientEmailValue,
        private_key: privateKey
    },

    acl: 'publicRead',
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        const originalName = path.basename(file.originalname.replace(/\s/g, '_'), extension);
        let folder = 'outros';
        if (file.mimetype.startsWith('image/')) folder = 'imagens';
        if (file.mimetype.startsWith('video/')) folder = 'videos';
        if (file.mimetype === 'application/pdf') folder = 'documentos';
        cb(null, `${folder}/${originalName}-${uniqueSuffix}${extension}`);
    }
});
console.log("--- storageEngine chamado com sucesso (sem cliente manual). ---");
// --- FIM DA ALTERAÇÃO ---

// --- INSTÂNCIA DO MULTER ---
const multerUpload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            console.warn(`[Multer File Filter] Tipo de arquivo REJEITADO: ${file.mimetype} (Original: ${file.originalname})`);
            cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Formato de arquivo não suportado!'), false);
        }
    },
    limits: {
        fileSize: 1024 * 1024 * 50 // 50MB
    }
});

// --- FUNÇÃO UPLOADER ---
const uploader = (multerInstance) => (req, res, next) => {
    multerInstance(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            console.error('[Multer Error]', err);
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ message: 'Arquivo muito grande. O limite é de 50MB.' });
            }
            if (err.code === 'LIMIT_UNEXPECTED_FILE') {
                return res.status(400).json({ message: 'Formato de arquivo não suportado.' });
            }
            return res.status(400).json({ message: `Erro no upload: ${err.message}` });
        } else if (err) {
            console.error("ERRO NÃO-MULTER NO UPLOAD PARA O GCS:", err);
            return res.status(500).json({ message: 'Ocorreu um erro interno no servidor durante o upload do arquivo.' });
        }
        next();
    });
};

// --- EXPORTAÇÃO ---
module.exports = {
    single: (fieldName) => uploader(multerUpload.single(fieldName)),
    array: (fieldName, maxCount) => uploader(multerUpload.array(fieldName, maxCount)),
    fields: (fieldsConfig) => uploader(multerUpload.fields(fieldsConfig)),
};