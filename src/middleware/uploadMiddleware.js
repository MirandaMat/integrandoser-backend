// server/src/middleware/uploadMiddleware.js
const multer = require('multer');
const MulterGoogleStorage = require('multer-google-storage');
const path = require('path');

// ===================================================================
// --- DEBUG LOGS (ANTES DA FORMATAÇÃO) ---
// ===================================================================
console.log("--- DEBUG GCS Credentials (ANTES) ---");
console.log("process.env.GCS_PROJECT_ID:", process.env.GCS_PROJECT_ID ? typeof process.env.GCS_PROJECT_ID : 'UNDEFINED');
console.log("process.env.GCS_CLIENT_EMAIL:", process.env.GCS_CLIENT_EMAIL ? typeof process.env.GCS_CLIENT_EMAIL : 'UNDEFINED');
console.log("process.env.GCS_PRIVATE_KEY:", process.env.GCS_PRIVATE_KEY ? 'DEFINIDO (parcial): ' + process.env.GCS_PRIVATE_KEY.substring(0, 30) + "..." : '*** UNDEFINED ***');
console.log("process.env.GCS_BUCKET_NAME:", process.env.GCS_BUCKET_NAME ? typeof process.env.GCS_BUCKET_NAME : 'UNDEFINED');
// ===================================================================

// É CRUCIAL formatar a chave privada...
const rawPrivateKey = process.env.GCS_PRIVATE_KEY || ''; // Pega a chave crua
const privateKey = rawPrivateKey.replace(/\\n/g, '\n'); // Formata

// ===================================================================
// --- DEBUG LOGS (DEPOIS DA FORMATAÇÃO) ---
// ===================================================================
console.log("--- DEBUG GCS Credentials (DEPOIS format) ---");
const projectIdValue = process.env.GCS_PROJECT_ID;
const clientEmailValue = process.env.GCS_CLIENT_EMAIL;
const bucketNameValue = process.env.GCS_BUCKET_NAME;

console.log("projectIdValue:", projectIdValue ? typeof projectIdValue : 'UNDEFINED');
console.log("clientEmailValue:", clientEmailValue ? typeof clientEmailValue : 'UNDEFINED');
console.log("privateKey (formatada):", privateKey ? 'DEFINIDO (parcial): ' + privateKey.substring(0, 30) + "..." : '*** VAZIA/UNDEFINED ***');
console.log("bucketNameValue:", bucketNameValue ? typeof bucketNameValue : 'UNDEFINED');

// Verifica explicitamente se são strings não vazias antes de chamar storageEngine
if (!projectIdValue || typeof projectIdValue !== 'string' ||
    !clientEmailValue || typeof clientEmailValue !== 'string' ||
    !privateKey || typeof privateKey !== 'string' || privateKey.length < 50 || // Chave privada deve ser longa
    !bucketNameValue || typeof bucketNameValue !== 'string') {
     console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
     console.error("!!! ERRO CRÍTICO: UMA OU MAIS CREDENCIAIS GCS ESTÃO INVÁLIDAS OU AUSENTES !!!");
     console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
     // Força um erro mais claro ANTES de chamar a biblioteca
     throw new Error("Credenciais GCS ausentes ou inválidas detectadas ANTES de chamar storageEngine.");
}
console.log("--- Todas as credenciais parecem válidas. Chamando storageEngine... ---");
// ===================================================================

// Lista de tipos de arquivo permitidos (vinda do seu arquivo original)
const allowedMimeTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/webm', 'video/ogg',
    'video/quicktime',
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

// 1. Configuração do storageEngine (com a correção do objeto 'credentials')
const storage = MulterGoogleStorage.storageEngine({
    projectId: projectIdValue, // Usa a variável local verificada
    bucket: bucketNameValue,   // Usa a variável local verificada

    credentials: {
        client_email: clientEmailValue, // Usa a variável local verificada
        private_key: privateKey         // Usa a variável local formatada e verificada
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

console.log("--- storageEngine chamado com sucesso. ---"); // Log se a chamada não travar

// ===================================================================
// --- INSTÂNCIA DO MULTER (Lógica 100% preservada) ---
// ===================================================================

// Instância base do Multer com as configurações de segurança
const multerUpload = multer({
    storage: storage,

    // Seu filtro de arquivos original foi mantido
    fileFilter: (req, file, cb) => {
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Formato de arquivo não suportado!'), false);
        }
    },

    // Seu limite de tamanho original foi mantido
    limits: {
        fileSize: 1024 * 1024 * 50 // 50MB
    }
});

// ===================================================================
// --- ESTRUTURA FLEXÍVEL (Lógica 100% preservada) ---
// ===================================================================
// Esta função de tratamento de erros é do seu arquivo original e está perfeita
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
            // Log do erro real do GCS no console do servidor
            console.error("ERRO NO UPLOAD PARA O GCS:", err);
            return res.status(500).json({ message: 'Ocorreu um erro no upload do arquivo.' });
        }
        next();
    });
};

// ===================================================================
// --- EXPORTAÇÃO DOS MÉTODOS (Lógica 100% preservada) ---
// ===================================================================
// Sua exportação original está perfeita e é mantida
module.exports = {
    single: (fieldName) => uploader(multerUpload.single(fieldName)),
    array: (fieldName, maxCount) => uploader(multerUpload.array(fieldName, maxCount)),
    fields: (fieldsConfig) => uploader(multerUpload.fields(fieldsConfig)),
};