// server/src/middleware/uploadMiddleware.js
const multer = require('multer');
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

// Formata a chave privada (corrige quebras de linha em variáveis de ambiente)
const gcsPrivateKey = process.env.GCS_PRIVATE_KEY.replace(/\\n/g, '\n').trim();

// --- 2. Inicializa o Cliente Oficial do Google Cloud Storage ---
let storageClient;
try {
    console.log('[GCS CLIENT] Tentando inicializar o cliente @google-cloud/storage...');
    storageClient = new Storage({
        projectId: process.env.GCS_PROJECT_ID,
        credentials: {
            client_email: process.env.GCS_CLIENT_EMAIL,
            private_key: gcsPrivateKey,
        }
    });
    console.log('[GCS CLIENT] Cliente @google-cloud/storage inicializado com sucesso.');
} catch (error) {
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.error('[GCS_CONFIG] Erro ao inicializar o cliente @google-cloud/storage:', error);
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    throw new Error('Falha ao inicializar o cliente Google Cloud Storage.');
}

// Pega a referência ao bucket
const bucket = storageClient.bucket(process.env.GCS_BUCKET_NAME);
console.log(`[GCS CLIENT] Referência ao bucket '${process.env.GCS_BUCKET_NAME}' obtida.`);


// --- 3. Configuração do Multer para Armazenamento em Memória ---
const memoryStorage = multer.memoryStorage(); // Usa a memória RAM temporariamente

// 3.1 Configuração GERAL (Documentos, Vídeos, Imagens) - Limite 50MB
const allowedMimeTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const multerUpload = multer({
    storage: memoryStorage,
    fileFilter: (req, file, cb) => {
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            console.warn(`[MULTER] Arquivo rejeitado (tipo inválido): ${file.originalname} (${file.mimetype})`);
            cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Formato de arquivo não suportado!'), false);
        }
    },
    limits: {
        fileSize: 1024 * 1024 * 50 // 50MB Limite
    }
});

// 3.2 Configuração APENAS IMAGENS (Para Comprovantes/Fotos) - Limite 10MB
const imageMimeTypes = [
    'image/jpeg', 'image/png', 'image/webp', 'image/jpg'
];

const multerImageUpload = multer({
    storage: memoryStorage,
    fileFilter: (req, file, cb) => {
        if (imageMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            console.warn(`[MULTER IMAGE] Arquivo rejeitado (não é imagem): ${file.originalname} (${file.mimetype})`);
            cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Apenas arquivos de imagem (JPG, PNG, WEBP) são permitidos.'), false);
        }
    },
    limits: { fileSize: 1024 * 1024 * 10 } // 10MB
});


// --- 4. Middleware de Upload para GCS ---
// Esta função pega o buffer da memória e envia para o Google Cloud Storage
const uploadToGCS = (req, res, next) => {
    // Verifica se há um arquivo (single) ou múltiplos arquivos (array/fields)
    const file = req.file;
    const files = req.files;

    if (!file && (!files || Object.keys(files).length === 0)) {
        // Nenhum arquivo para fazer upload, apenas segue para a próxima rota
        return next();
    }

    const uploadPromises = [];

    // Função auxiliar para criar a promessa de upload
    const createUploadPromise = (fileToUpload) => {
        return new Promise((resolve, reject) => {
            if (!fileToUpload) return resolve();

            console.log(`[GCS UPLOAD] Iniciando upload para: ${fileToUpload.originalname}`);
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const extension = path.extname(fileToUpload.originalname);
            const destinationFileName = `${fileToUpload.fieldname}-${uniqueSuffix}${extension}`;

            const blob = bucket.file(destinationFileName);
            const blobStream = blob.createWriteStream({
                resumable: false, // Upload simples
                contentType: fileToUpload.mimetype,
            });

            blobStream.on('error', (err) => {
                console.error(`[GCS UPLOAD] Erro no stream para ${destinationFileName}:`, err);
                reject(err);
            });

            blobStream.on('finish', async () => {
                const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
                console.log(`[GCS UPLOAD] Upload concluído: ${destinationFileName} -> ${publicUrl}`);

                try {
                    // Torna o arquivo público
                    await blob.makePublic();
                } catch (err) {
                    console.error(`[GCS UPLOAD] Falha ao tornar objeto público:`, err);
                    reject(err); 
                    return;
                }

                // Adiciona a URL pública ao objeto do arquivo em req
                fileToUpload.gcsUrl = publicUrl;
                fileToUpload.gcsFilename = destinationFileName;
                resolve();
            });

            blobStream.end(fileToUpload.buffer); // Envia o buffer da memória
        });
    };

    // Processa um único arquivo (req.file)
    if (file) {
        uploadPromises.push(createUploadPromise(file));
    }

    // Processa múltiplos arquivos (req.files)
    if (files) {
        if (Array.isArray(files)) { // Caso de multer.array()
            files.forEach(f => uploadPromises.push(createUploadPromise(f)));
        } else { // Caso de multer.fields()
            Object.values(files).forEach(fileArray => {
                if (Array.isArray(fileArray)) {
                    fileArray.forEach(f => uploadPromises.push(createUploadPromise(f)));
                }
            });
        }
    }

    // Espera todos os uploads terminarem
    Promise.all(uploadPromises)
        .then(() => {
            next(); // Prossegue para a rota final
        })
        .catch((err) => {
            console.error('[GCS UPLOAD] Ocorreu um erro durante um ou mais uploads:', err);
            res.status(500).json({ message: 'Erro ao fazer upload do arquivo para o armazenamento.' });
        });
};


// --- 5. Função "Invólucro" para Erros do Multer ---
// Captura erros de limite de tamanho ou tipo de arquivo antes de tentar enviar para o GCS
const handleMulterError = (multerInstance) => (req, res, next) => {
    multerInstance(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            console.warn(`[MULTER ERROR] Código: ${err.code}, Campo: ${err.field}`);
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ message: 'Arquivo muito grande.' });
            }
            if (err.code === 'LIMIT_UNEXPECTED_FILE') {
                // A mensagem personalizada do fileFilter vem aqui
                return res.status(400).json({ message: err.message || 'Formato de arquivo não suportado.' });
            }
            return res.status(400).json({ message: `Erro no upload: ${err.message}` });
        } else if (err) {
            console.error('[UNEXPECTED MULTER_ERROR]', err);
            return res.status(500).json({ message: 'Ocorreu um erro inesperado ao processar o arquivo.' });
        }
        next();
    });
};

// --- 6. Exportação dos Métodos ---
module.exports = {
    // Upload Geral (Docs, Videos, Imagens) - 50MB
    single: (fieldName) => [handleMulterError(multerUpload.single(fieldName)), uploadToGCS],
    array: (fieldName, maxCount) => [handleMulterError(multerUpload.array(fieldName, maxCount)), uploadToGCS],
    fields: (fieldsConfig) => [handleMulterError(multerUpload.fields(fieldsConfig)), uploadToGCS],
    
    // Upload Específico para IMAGENS (Comprovantes, Perfil) - 10MB
    singleImage: (fieldName) => [handleMulterError(multerImageUpload.single(fieldName)), uploadToGCS],
    
    // Exporta o bucket caso precise de acesso direto em outras rotas
    gcsBucket: bucket
};