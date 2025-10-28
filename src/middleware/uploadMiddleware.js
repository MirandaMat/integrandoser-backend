// server/src/middleware/uploadMiddleware.js
const multer = require('multer');
const MulterGoogleStorage = require('multer-google-storage');
const path = require('path');

// ===================================================================
// --- CONFIGURAÇÃO DO GOOGLE CLOUD STORAGE ---
// ===================================================================

// É CRUCIAL formatar a chave privada que vem das variáveis de ambiente
// O Railway (ou Heroku) lê quebras de linha como literais "\n" em vez de novas linhas.
const privateKey = (process.env.GCS_PRIVATE_KEY || '').replace(/\\n/g, '\n');

// Lista de tipos de arquivo permitidos (vinda do seu arquivo original)
const allowedMimeTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/webm', 'video/ogg',
    'video/quicktime',
    'application/pdf', 'application/msword', 
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

// 1. Substituímos multer.diskStorage pelo storageEngine do GCS
const storage = MulterGoogleStorage.storageEngine({
    // ID do seu projeto Google Cloud
    projectId: process.env.GCS_PROJECT_ID,
    // Nome do seu bucket no Google Cloud Storage
    bucket: process.env.GCS_BUCKET_NAME,

    // Passa as credenciais dentro de um objeto 'credentials'
    // usando os nomes esperados pela API (snake_case)
    credentials: {
        client_email: process.env.GCS_CLIENT_EMAIL,
        private_key: privateKey // Usa a chave privada formatada
    },

    // Define que os arquivos enviados serão publicamente legíveis
    acl: 'publicRead',

    // Define como os arquivos serão nomeados e organizados no bucket
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        // Remove espaços e a extensão do nome original
        const originalName = path.basename(file.originalname.replace(/\s/g, '_'), extension);

        // Organiza em pastas com base no tipo de arquivo
        let folder = 'outros';
        if (file.mimetype.startsWith('image/')) folder = 'imagens';
        if (file.mimetype.startsWith('video/')) folder = 'videos';
        if (file.mimetype === 'application/pdf') folder = 'documentos';

        // Monta o nome final do arquivo no bucket (ex: 'imagens/nome_original-12345.jpg')
        cb(null, `${folder}/${originalName}-${uniqueSuffix}${extension}`);
    }
});

// ===================================================================
// --- INSTÂNCIA DO MULTER (Lógica 100% preservada) ---
// ===================================================================

// Instância base do Multer com as configurações de segurança
// Note que o 'storage' agora aponta para o GCS
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