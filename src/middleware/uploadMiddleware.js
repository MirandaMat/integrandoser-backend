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

// Formata a chave privada
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

const allowedMimeTypes = [ // Mesma lista de antes
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


// --- 4. Middleware de Upload para GCS ---
// Esta função será chamada *depois* do multer ter processado o arquivo em memória
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
            if (!fileToUpload) return resolve(); // Ignora se o arquivo não existir (p.ex., em 'fields' opcionais)

            console.log(`[GCS UPLOAD] Iniciando upload para: ${fileToUpload.originalname}`);
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const extension = path.extname(fileToUpload.originalname);
            const destinationFileName = `${fileToUpload.fieldname}-${uniqueSuffix}${extension}`;

            const blob = bucket.file(destinationFileName);
            const blobStream = blob.createWriteStream({
                resumable: false, // Upload simples para arquivos menores
                contentType: fileToUpload.mimetype,
            });

            blobStream.on('error', (err) => {
                console.error(`[GCS UPLOAD] Erro no stream para ${destinationFileName}:`, err);
                reject(err);
            });

            blobStream.on('finish', () => {
                const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
                console.log(`[GCS UPLOAD] Upload concluído: ${destinationFileName} -> ${publicUrl}`);

                // Adiciona a URL pública ao objeto do arquivo em req
                // Isso permite que sua rota final saiba onde o arquivo foi salvo
                fileToUpload.gcsUrl = publicUrl;
                fileToUpload.gcsFilename = destinationFileName; // Salva o nome final também
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
            console.log('[GCS UPLOAD] Todos os uploads foram concluídos com sucesso.');
            next(); // Prossegue para a rota final
        })
        .catch((err) => {
            console.error('[GCS UPLOAD] Ocorreu um erro durante um ou mais uploads:', err);
            // Retorna um erro genérico para o cliente
            res.status(500).json({ message: 'Erro ao fazer upload do arquivo para o armazenamento.' });
            // Não chama next() para interromper a cadeia de middleware
        });
};


// --- 5. Função "Invólucro" para Erros do Multer (Executado ANTES do uploadToGCS) ---
const handleMulterError = (multerInstance) => (req, res, next) => {
    multerInstance(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            console.warn(`[MULTER ERROR] Código: ${err.code}, Campo: ${err.field}`);
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ message: 'Arquivo muito grande. O limite é de 50MB.' });
            }
            if (err.code === 'LIMIT_UNEXPECTED_FILE') {
                return res.status(400).json({ message: 'Formato de arquivo não suportado.' });
            }
            // Outros erros Multer podem ser tratados aqui
            return res.status(400).json({ message: `Erro no upload: ${err.message}` });
        } else if (err) {
            // Erro inesperado durante o processamento do Multer
            console.error('[UNEXPECTED MULTER_ERROR]', err);
            return res.status(500).json({ message: 'Ocorreu um erro inesperado ao processar o arquivo.' });
        }
        // Se não houve erro no Multer, prossegue para o próximo middleware (uploadToGCS)
        next();
    });
};

// --- 6. Exportação dos Métodos ---
// Agora exportamos uma *sequência* de middlewares: primeiro o Multer, depois o upload para GCS
module.exports = {
    single: (fieldName) => [handleMulterError(multerUpload.single(fieldName)), uploadToGCS],
    array: (fieldName, maxCount) => [handleMulterError(multerUpload.array(fieldName, maxCount)), uploadToGCS],
    fields: (fieldsConfig) => [handleMulterError(multerUpload.fields(fieldsConfig)), uploadToGCS],
    // Se precisar de alguma rota que use apenas GCS (sem multer), exporte o cliente
    gcsBucket: bucket
};