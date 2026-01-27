const express = require('express');
const pool = require('../config/db.js');
const { protect, isAdmin } = require('../middleware/authMiddleware.js');
const upload = require('../middleware/uploadMiddleware.js');
const router = express.Router();

// Função auxiliar para converter BigInt para String
const serializeBigInts = (data) => {
    if (data === null || data === undefined) return data;
    const isArray = Array.isArray(data);
    const dataToProcess = isArray ? data : [data];

    const processedData = dataToProcess.map(item => {
        const newItem = {};
        for (const key in item) {
            if (typeof item[key] === 'bigint') newItem[key] = item[key].toString();
            else newItem[key] = item[key];
        }
        return newItem;
    });

    return isArray ? processedData : processedData[0];
};


// Função auxiliar para parsear os dados de forma segura
const getParsedSection = (sectionData, existingSection) => {
    if (!sectionData) {
        return existingSection;
    }
    if (typeof sectionData === 'object') {
        return sectionData;
    }
    if (typeof sectionData === 'string') {
        if (sectionData === '[object Object]') {
            console.warn(`Aviso: Recebida string inválida '[object Object]' para uma seção. Ignorando a atualização para esta seção para evitar erro.`);
            return existingSection;
        }
        try {
            return JSON.parse(sectionData);
        } catch (e) {
            console.error(`ERRO ao fazer parse da seção, que chegou como string: "${sectionData}"`, e);
            return existingSection;
        }
    }
    return existingSection;
};

// --- ROTAS PARA BLOG POSTS ---
router.get('/blog', async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        const postsFromDb = await conn.query("SELECT id, title, excerpt, category, paragraphs, post_date, image_url, video_url, likes FROM blog_posts ORDER BY post_date DESC");
        
        const posts = postsFromDb.map(post => {
            try {
                post.paragraphs = post.paragraphs ? JSON.parse(post.paragraphs) : [];
            } catch (e) {
                console.warn(`Aviso: Falha ao fazer parse dos parágrafos para o post ID ${post.id}.`);
                post.paragraphs = [post.paragraphs || ''];
            }
            return post;
        });

        res.json(serializeBigInts(posts));
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar posts do blog.', error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

router.post('/blog', protect, isAdmin, upload.fields([{ name: 'image', maxCount: 1 }, { name: 'video', maxCount: 1 }]), async (req, res) => {
    const { title, excerpt, category, paragraphs } = req.body;
    const imageUrl = (req.files && req.files.image && req.files.image[0].gcsUrl) ? req.files.image[0].gcsUrl : null;
    const videoUrl = (req.files && req.files.video && req.files.video[0].gcsUrl) ? req.files.video[0].gcsUrl : null;
    const post_date = new Date().toISOString().slice(0, 10);

    let conn;
    try {
        conn = await pool.getConnection();
        const result = await conn.query(
            "INSERT INTO blog_posts (title, excerpt, category, paragraphs, post_date, image_url, video_url) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [title, excerpt, category, paragraphs, post_date, imageUrl, videoUrl]
        );

        // Adaptação da resposta para incluir o ID corretamente
         const insertId = Array.isArray(result) ? result[0].insertId : result.insertId;

        res.status(201).json({ message: 'Post criado com sucesso!', id: String(result.insertId) });
    } catch (error) {
        console.error("Erro ao criar post:", error);
        res.status(500).json({ message: 'Erro ao criar post.', error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

router.put('/blog/:id', protect, isAdmin, upload.fields([{ name: 'image', maxCount: 1 }, { name: 'video', maxCount: 1 }]), async (req, res) => {
    const { id } = req.params;
    const { title, excerpt, category, paragraphs, post_date } = req.body;
    
    let conn;
    try {
        conn = await pool.getConnection();
        const posts = await conn.query("SELECT image_url, video_url FROM blog_posts WHERE id = ?", [id]);
        
        if (posts.length === 0) {
            return res.status(404).json({ message: 'Post não encontrado.' });
        }
        const post = posts[0];

        const imageUrl = (req.files && req.files.image && req.files.image[0].gcsUrl) ? req.files.image[0].gcsUrl : post.image_url;
        const videoUrl = (req.files && req.files.video && req.files.video[0].gcsUrl) ? req.files.video[0].gcsUrl : post.video_url;

        // Garante que a data esteja no formato AAAA-MM-DD
        const formattedDate = new Date(post_date).toISOString().slice(0, 10);

        await conn.query(
            "UPDATE blog_posts SET title = ?, excerpt = ?, category = ?, paragraphs = ?, post_date = ?, image_url = ?, video_url = ? WHERE id = ?",
            // Usa a data formatada na query
            [title, excerpt, category, paragraphs, formattedDate, imageUrl, videoUrl, id]
        );
        
        res.json({ message: 'Post atualizado com sucesso!' });

    } catch (error) {
        console.error("Erro ao atualizar post:", error);
        res.status(500).json({ message: 'Erro ao atualizar post.', error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

router.delete('/blog/:id', protect, isAdmin, async (req, res) => {
    const { id } = req.params;
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query("DELETE FROM blog_posts WHERE id = ?", [id]);
        res.json({ message: 'Post apagado com sucesso.' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao apagar post.', error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

router.post('/blog/:id/like', async (req, res) => {
    const { id } = req.params;
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query("UPDATE blog_posts SET likes = likes + 1 WHERE id = ?", [id]);
        res.status(200).json({ message: 'Post curtido com sucesso!' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao curtir o post.', error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// --- ROTAS PARA DEPOIMENTOS ---
router.get('/testimonials', async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        const testimonials = await conn.query("SELECT * FROM testimonials ORDER BY id DESC");
        res.json(serializeBigInts(testimonials));
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar depoimentos.', error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

router.post('/testimonials', protect, isAdmin, upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'video', maxCount: 1 }]), async (req, res) => {
    const { quote, name, role } = req.body;
    const photoUrl = (req.files && req.files.photo && req.files.photo[0].gcsUrl) ? req.files.photo[0].gcsUrl : null;
    const videoUrl = (req.files && req.files.video && req.files.video[0].gcsUrl) ? req.files.video[0].gcsUrl : null;

    let conn;
    try {
        conn = await pool.getConnection();
        const result = await conn.query(
            "INSERT INTO testimonials (quote, name, role, photo_url, video_url) VALUES (?, ?, ?, ?, ?)",
            [quote, name, role, photoUrl, videoUrl]
        );
        const insertId = Array.isArray(result) ? result[0].insertId : result.insertId;
        res.status(201).json({ message: 'Depoimento criado com sucesso!', id: String(result.insertId) });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao criar depoimento.', error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

router.delete('/testimonials/:id', protect, isAdmin, async (req, res) => {
    const { id } = req.params;
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query("DELETE FROM testimonials WHERE id = ?", [id]);
        res.json({ message: 'Depoimento apagado com sucesso.' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao apagar depoimento.', error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

router.put('/testimonials/:id', protect, isAdmin, upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'video', maxCount: 1 }]), async (req, res) => {
    const { id } = req.params;
    const { quote, name, role } = req.body;
    let conn;
    try {
        conn = await pool.getConnection();
        const [testimonial] = await conn.query("SELECT photo_url, video_url FROM testimonials WHERE id = ?", [id]);
        const photoUrl = (req.files && req.files.photo && req.files.photo[0].gcsUrl) ? req.files.photo[0].gcsUrl : testimonial.photo_url;
        const videoUrl = (req.files && req.files.video && req.files.video[0].gcsUrl) ? req.files.video[0].gcsUrl : testimonial.video_url;
        await conn.query(
            "UPDATE testimonials SET quote = ?, name = ?, role = ?, photo_url = ?, video_url = ? WHERE id = ?",
            [quote, name, role, photoUrl, videoUrl, id]
        );
        res.json({ message: 'Depoimento atualizado com sucesso!' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao atualizar depoimento.', error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// --- ROTAS PARA SERVIÇOS ---
router.get('/services', async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        const servicesFromDb = await conn.query("SELECT * FROM services ORDER BY id DESC");
        
        console.log('[DEBUG] Dados brutos de TODOS os serviços buscados no DB:', JSON.stringify(servicesFromDb, null, 2));

        const services = servicesFromDb.map(service => {
            // --- CORREÇÃO APLICADA AQUI ---
            // Verificamos se 'details' é uma string antes de tentar o parse.
            if (service.details && typeof service.details === 'string') {
                try {
                    service.details = JSON.parse(service.details);
                } catch (e) {
                    console.warn(`Aviso: Falha ao fazer parse da STRING de detalhes para o serviço ID ${service.id}.`);
                    service.details = null;
                }
            }
            // Se 'details' já for um objeto, ele simplesmente é retornado como está.
            return service;
        });

        res.json(serializeBigInts(services));
    } catch (error) {
        console.error("Erro ao buscar serviços:", error);
        res.status(500).json({ message: 'Erro ao buscar serviços.', error: error.message });
    } finally {
        if (conn) conn.release();
    }
});


router.post('/services', protect, isAdmin, upload.single('image'), async (req, res) => {
    let { title, slug, description, details } = req.body;
    slug = slug ? slug.trim() : slug;

    const imageUrl = (req.file && req.file.gcsUrl) ? req.file.gcsUrl : null;

    if (!title || !slug) {
        return res.status(400).json({ message: 'Título e Slug são campos obrigatórios.' });
    }

    try { if (details) JSON.parse(details); } catch (e) { return res.status(400).json({ message: 'O campo "Detalhes" contém um JSON inválido.' });}
    
    let conn;
    try {
        conn = await pool.getConnection();
        const result = await conn.query(
            "INSERT INTO services (title, slug, description, details, image_url) VALUES (?, ?, ?, ?, ?)",
            [title, slug, description, details, imageUrl] 
        );
        const insertId = Array.isArray(result) ? result[0].insertId : result.insertId;
        res.status(201).json({ message: 'Serviço criado com sucesso!', id: String(insertId) });
    } catch (error) {
        console.error("Erro ao criar serviço:", error);
        if (error.code === 'ER_DUP_ENTRY') {
             return res.status(409).json({ message: `O slug "${slug}" já existe. Por favor, escolha outro.` });
        }
        res.status(500).json({ message: 'Erro ao criar serviço.', error: error.message });
    } finally {
        if (conn) conn.release();
    }
});



router.put('/services/:id', protect, isAdmin, upload.single('image'), async (req, res) => {
    const { id } = req.params;
    let { title, slug, description, details } = req.body;

    slug = slug ? slug.trim() : slug;

    if (!title || !slug) {
        return res.status(400).json({ message: 'Título e Slug são campos obrigatórios.' });
    }

    try { if (details) JSON.parse(details); } catch (e) { return res.status(400).json({ message: 'O campo "Detalhes" contém um JSON inválido.' });}
    
    let conn;
    try {
        conn = await pool.getConnection();

        const services = await conn.query("SELECT image_url FROM services WHERE id = ?", [id]);
        if (services.length === 0) {
            return res.status(404).json({ message: 'Serviço não encontrado.' });
        }
        const service = services[0];
        
        const imageUrl = (req.file && req.file.gcsUrl) ? req.file.gcsUrl : service.image_url;
        await conn.query(
            "UPDATE services SET title = ?, slug = ?, description = ?, details = ?, image_url = ? WHERE id = ?",
            [title, slug, description, details, imageUrl, id] // O slug já vai corrigido para o DB
        );
        res.json({ message: 'Serviço atualizado com sucesso!' });
    } catch (error) {
        console.error("Erro ao atualizar serviço:", error);
        if (error.code === 'ER_DUP_ENTRY') {
             return res.status(409).json({ message: `O slug "${slug}" já existe. Por favor, escolha outro.` });
        }
        res.status(500).json({ message: 'Erro ao atualizar serviço.', error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

router.delete('/services/:id', protect, isAdmin, async (req, res) => {
    const { id } = req.params;
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query("DELETE FROM services WHERE id = ?", [id]);
        res.json({ message: 'Serviço apagado com sucesso.' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao apagar serviço.', error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// ===================================================================
// ROTAS PARA A PÁGINA TPT
// ===================================================================

// GET /api/content/tpt - Busca o conteúdo da página TPT
router.get('/tpt', async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        
        // ## CORREÇÃO DEFINITIVA AQUI ##
        // Removemos a desestruturação "[rows]" para tratar o resultado como um array de linhas.
        const rows = await conn.query("SELECT * FROM tpt_page_content WHERE id = 1");
        
        // Se a tabela estiver vazia ou a linha não for encontrada, retorna um objeto vazio.
        if (!rows || rows.length === 0) {
            return res.json({});
        }

        // Agora 'content' é garantidamente o objeto da primeira linha.
        const content = rows[0]; 
        
        // A lógica de parse agora funcionará corretamente no objeto 'content'.
        Object.keys(content).forEach(key => {
            const value = content[key];
            if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
                try {
                    content[key] = JSON.parse(value);
                } catch (e) {
                    console.warn(`Aviso: Falha ao fazer parse do campo ${key} da página TPT.`);
                    content[key] = (value.startsWith('[')) ? [] : {}; 
                }
            }
        });
        
        res.json(serializeBigInts(content));

    } catch (error) {
        console.error("Erro ao buscar conteúdo da página TPT:", error);
        res.status(500).json({ message: 'Erro ao buscar conteúdo da página TPT.' });
    } finally {
        if (conn) conn.release();
    }
});

// PUT /api/content/tpt - Atualiza o conteúdo da página TPT
router.put('/tpt', protect, isAdmin, upload.single('about_image'), async (req, res) => {
    // Agora esperamos um único campo 'tpt_data' com o JSON
    const { tpt_data } = req.body;
    
    if (!tpt_data) {
        return res.status(400).json({ message: "Dados da página TPT não foram fornecidos." });
    }

    let conn;
    try {
        conn = await pool.getConnection();

        // 1. Faz o parse da string JSON recebida
        let updateObject;
        try {
            updateObject = JSON.parse(tpt_data);
        } catch (e) {
            return res.status(400).json({ message: "Os dados enviados para TPT contêm um JSON inválido." });
        }

        // 2. Remove campos que não devem ser salvos diretamente
        delete updateObject.id;
        delete updateObject.updated_at;

        // 3. Atualiza a URL da imagem se um novo arquivo foi enviado
        if (req.file && req.file.gcsUrl) { // <<< Verifica se gcsUrl existe
            updateObject.about_image_url = req.file.gcsUrl; // <<< Linha corrigida
        } else if (req.file) {
             console.warn(`[PUT /tpt] Arquivo ${req.file.originalname} recebido, mas URL GCS não encontrada. Mantendo URL antiga se existir.`);
             // Remove a propriedade para não tentar salvar undefined ou sobrescrever com null
             // A URL antiga (se houver) será mantida no JSON_MERGE_PATCH implícito
             delete updateObject.about_image_url;
        }
        
        // 4. Constrói a query de UPDATE dinamicamente
        const fields = Object.keys(updateObject);
        if (fields.length === 0) {
            return res.status(400).json({ message: "Nenhum dado válido para atualizar." });
        }
        
        const setClause = fields.map(field => `${field} = ?`).join(', ');
        const values = fields.map(field => {
            const value = updateObject[field];
            // Stringify de volta apenas os campos que são arrays/objetos complexos
            return (typeof value === 'object' && value !== null) ? JSON.stringify(value) : value;
        });

        await conn.query(`UPDATE tpt_page_content SET ${setClause} WHERE id = 1`, values);
        
        res.json({ message: 'Conteúdo da página TPT atualizado com sucesso!' });

    } catch (error) {
        console.error("Erro ao atualizar conteúdo da página TPT:", error);
        res.status(500).json({ message: 'Erro ao atualizar conteúdo da página TPT.', error: error.message });
    } finally {
        if (conn) conn.release();
    }
});


// ===================================================================
// ROTAS PARA CONTEÚDO DO SITE (HOME, SOBRE, RODAPÉ, ETC.)
// ===================================================================

// GET /api/content/site - Busca o conteúdo geral do site
router.get('/site', async (req, res) => {
    let conn;
    try {
        // --- START: Added Logs ---
        console.log('[GET /site] Attempting to get connection from pool...');
        conn = await pool.getConnection(); //
        console.log('[GET /site] Connection obtained successfully.');
        // --- END: Added Logs ---

        // --- START: Added Logs ---
        console.log('[GET /site] Executing query: SELECT content FROM site_content WHERE id = 1');
        const [result] = await conn.query("SELECT content FROM site_content WHERE id = 1"); //
        console.log('[GET /site] Query executed. Result:', result ? 'Data found' : 'No data');
        // --- END: Added Logs ---
        
        let content = {}; 

        if (result && result.content) {
            if (typeof result.content === 'string') {
                try {
                    content = JSON.parse(result.content); //
                     console.log('[GET /site] JSON parsed successfully.'); // Added Log
                } catch (parseError) {
                    console.error("[GET /site] CRITICAL ERROR parsing JSON:", parseError); // Modified Log
                    content = { error: "Falha ao carregar conteúdo do site (JSON inválido)." }; 
                }
            } else if (typeof result.content === 'object') {
                content = result.content; //
                console.log('[GET /site] Content is already an object.'); // Added Log
            }
        } else {
             console.log('[GET /site] No content found in database result.'); // Added Log
        }

        console.log('[GET /site] Sending JSON response.'); // Added Log
        res.json(content); //

    } catch (dbError) { 
        // --- START: Modified Logs ---
        console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
        // Log if the connection failed OR the query failed
        if (!conn) {
             console.error('[GET /site] CRITICAL ERROR getting connection from pool:', dbError);
        } else {
             console.error('[GET /site] CRITICAL ERROR executing query or during JSON processing:', dbError);
        }
        console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
         // --- END: Modified Logs ---
        res.status(500).json({ message: 'Erro no servidor ao buscar conteúdo do site.' }); //
    } finally {
        if (conn) {
             console.log('[GET /site] Releasing database connection.'); // Added Log
             conn.release(); //
        } else {
             console.log('[GET /site] No connection to release.'); // Added Log
        }
    }
});

// PUT /api/content/site - Atualiza o conteúdo geral do site
// PUT /api/content/site - Atualiza o conteúdo geral do site (VERSÃO CORRIGIDA)
router.put('/site', protect, isAdmin, upload.fields([
    { name: 'hero_video', maxCount: 1 },
    { name: 'about_logo', maxCount: 1 },
    { name: 'founder_image', maxCount: 1 },
    { name: 'tpt_media', maxCount: 1 },
    { name: 'partner_logos', maxCount: 10 }
]), async (req, res) => {

    console.log('--- [PUT /site] REQUEST RECEIVED ---');
    console.log('[PUT /site] req.body:', JSON.stringify(req.body, null, 2));
    console.log('[PUT /site] req.files:', JSON.stringify(req.files, null, 2));

    const sectionsToUpdate = ['home', 'about', 'founder', 'footer'];
    const updatedSectionKey = sectionsToUpdate.find(key => req.body[key]);

    console.log(`[PUT /site] Detected section key to update: ${updatedSectionKey}`);

    if (!updatedSectionKey) {
        console.error('[PUT /site] Error: No valid section key found in req.body. Responding 400.');
        return res.status(400).json({ message: 'Nenhuma seção para atualizar foi fornecida no corpo da requisição.' });
    }

    let conn;
    try {
        conn = await pool.getConnection(); //

        let dataToMerge = {};
        const sectionDataString = req.body[updatedSectionKey];

        console.log(`[PUT /site] Received section data string for key '${updatedSectionKey}'. Type: ${typeof sectionDataString}`);
        // Log the string itself ONLY if it's reasonably short
        if (typeof sectionDataString === 'string' && sectionDataString.length < 500) {
            console.log(`[PUT /site] String content:`, sectionDataString);
        } else if (typeof sectionDataString === 'string') {
            console.log(`[PUT /site] Received section data as a string (length: ${sectionDataString.length}).`);
        }

        // --- PASSO 1: Parse do JSON recebido ---
        if (typeof sectionDataString === 'string') {
            try {
                dataToMerge = JSON.parse(sectionDataString); // Tenta fazer o parse
                console.log(`[PUT /site] Successfully parsed JSON for key '${updatedSectionKey}'. Initial dataToMerge:`, JSON.stringify(dataToMerge));
            } catch (e) {
                console.error(`[PUT /site] Error parsing JSON string for key '${updatedSectionKey}'. Error:`, e);
                console.error(`[PUT /site] The invalid string was:`, sectionDataString);
                return res.status(400).json({ message: `O conteúdo da seção '${updatedSectionKey}' não é um JSON válido.` });
            }
        } else {
            console.error(`[PUT /site] Error: Section data for key '${updatedSectionKey}' was not received as a string. Type was: ${typeof sectionDataString}. Responding 400.`);
            return res.status(400).json({ message: `O conteúdo da seção '${updatedSectionKey}' não foi enviado como uma string JSON.` });
        }

        // --- PASSO 2: Adicionar/Sobrescrever URLs dos NOVOS arquivos ---
        if (req.files) {
            console.log('[PUT /site] Processing uploaded files to merge URLs...');

            // Home Section Files
            if (updatedSectionKey === 'home' && req.files.hero_video) {
                const file = req.files.hero_video[0];
                if (file && file.gcsUrl) { // <<< Verifica se gcsUrl existe
                    dataToMerge.hero_video_url = file.gcsUrl; // <<< Usa gcsUrl
                    console.log(`[PUT /site] Merged hero_video_url: ${dataToMerge.hero_video_url}`);
                } else {
                    console.warn(`[PUT /site] hero_video recebido, mas GCS URL não encontrada. Mantendo URL antiga se existir.`);
                    delete dataToMerge.hero_video_url; // Remove para manter o valor antigo no merge
                }
            }
            if (updatedSectionKey === 'home' && req.files.tpt_media) {
                const file = req.files.tpt_media[0];
                if (file && file.gcsUrl) { // <<< Verifica se gcsUrl existe
                    dataToMerge.tpt_media_url = file.gcsUrl; // <<< Usa gcsUrl
                    dataToMerge.tpt_media_type = file.mimetype.startsWith('video') ? 'video' : 'image';
                    console.log(`[PUT /site] Merged tpt_media_url: ${dataToMerge.tpt_media_url}, type: ${dataToMerge.tpt_media_type}`);
                } else {
                    console.warn(`[PUT /site] tpt_media recebido, mas GCS URL não encontrada. Mantendo URL antiga se existir.`);
                    delete dataToMerge.tpt_media_url; // Remove para manter o valor antigo no merge
                    delete dataToMerge.tpt_media_type;
                }
            }

            // About Section Files
            if (updatedSectionKey === 'about' && req.files.about_logo) {
                const file = req.files.about_logo[0];
                if (file && file.gcsUrl) { // <<< Verifica se gcsUrl existe
                    dataToMerge.logo_url = file.gcsUrl; // <<< Usa gcsUrl
                    console.log(`[PUT /site] Merged about logo_url: ${dataToMerge.logo_url}`);
                } else {
                     console.warn(`[PUT /site] about_logo recebido, mas GCS URL não encontrada. Mantendo URL antiga se existir.`);
                     delete dataToMerge.logo_url; // Remove para manter o valor antigo no merge
                }
            }
            if (updatedSectionKey === 'about' && req.files.partner_logos) {
                const existingLogos = Array.isArray(dataToMerge.partner_logos) ? dataToMerge.partner_logos : [];
                // Filtra apenas os arquivos que tiveram upload bem-sucedido para GCS
                const newLogoUrls = req.files.partner_logos
                                        .filter(file => file && file.gcsUrl) // <<< Filtra por gcsUrl existente
                                        .map(file => file.gcsUrl); // <<< Mapeia para gcsUrl
                dataToMerge.partner_logos = [...existingLogos, ...newLogoUrls]; // Combina
                console.log(`[PUT /site] Merged ${newLogoUrls.length} new partner logo URLs (GCS success). Total now: ${dataToMerge.partner_logos.length}`);
            }

            // Founder Section File
            if (updatedSectionKey === 'founder' && req.files.founder_image) {
                const file = req.files.founder_image[0];
                if (file && file.gcsUrl) { // <<< Verifica se gcsUrl existe
                    dataToMerge.image_url = file.gcsUrl; // <<< Usa gcsUrl
                    console.log(`[PUT /site] Merged founder image_url: ${dataToMerge.image_url}`);
                } else {
                    console.warn(`[PUT /site] founder_image recebido, mas GCS URL não encontrada. Mantendo URL antiga se existir.`);
                    delete dataToMerge.image_url; // Remove para manter o valor antigo no merge
                }
            }
        } else {
            console.log('[PUT /site] No new files received in req.files.');
        }

        // --- PASSO 3: Preparar e Salvar no Banco ---
        const updatePayload = { [updatedSectionKey]: dataToMerge };
        const updatePayloadString = JSON.stringify(updatePayload);
        console.log(`[PUT /site] Final payload string for DB merge:`, updatePayloadString);

        const [check] = await conn.query("SELECT id FROM site_content WHERE id = 1"); //
        if (!check) {
            console.log(`[PUT /site] Row with id=1 not found. Inserting new row.`);
            await conn.query(`INSERT INTO site_content (id, content) VALUES (1, ?)`, [updatePayloadString]); //
        } else {
            console.log(`[PUT /site] Row with id=1 found. Updating using JSON_MERGE_PATCH.`);
            const query = `
                UPDATE site_content
                SET content = JSON_MERGE_PATCH(COALESCE(content, '{}'), ?)
                WHERE id = 1
            `; //
            await conn.query(query, [updatePayloadString]); //
        }

        console.log(`[PUT /site] Update successful for section '${updatedSectionKey}'.`);
        res.json({ message: `Seção '${updatedSectionKey}' atualizada com sucesso!` });

    } catch (error) {
        console.error(`[PUT /site] Error during database operation or final processing for section '${updatedSectionKey}':`, error);
        res.status(500).json({ message: 'Erro ao atualizar conteúdo do site.', error: error.message }); //
    } finally {
        if (conn) conn.release(); //
    }
});


// GET /api/content/services/:slug - Busca um serviço específico pelo slug
router.get('/services/:slug', async (req, res) => {
    const { slug } = req.params;
    let conn;
    try {
        conn = await pool.getConnection();
        const servicesFromDb = await conn.query("SELECT * FROM services WHERE slug = ?", [slug]);

        console.log(`[DEBUG] Dados brutos do serviço buscado no DB para o slug: ${slug}`, JSON.stringify(servicesFromDb, null, 2));

        if (servicesFromDb.length === 0) {
            return res.status(404).json({ message: 'Serviço não encontrado.' });
        }

        const service = servicesFromDb[0];
        
        // --- CORREÇÃO APLICADA AQUI ---
        // Verificamos se 'details' é uma string antes de tentar o parse.
        if (service.details && typeof service.details === 'string') {
            try {
                service.details = JSON.parse(service.details);
            } catch (e) {
                console.warn(`Aviso: Falha ao fazer parse da STRING de detalhes para o serviço ID ${service.id}.`);
                service.details = null;
            }
        }
        // Se 'details' já for um objeto, não fazemos nada e ele segue como está.

        res.json(serializeBigInts(service));

    } catch (error) {
        console.error("Erro ao buscar serviço pelo slug:", error);
        res.status(500).json({ message: 'Erro ao buscar serviço.', error: error.message });
    } finally {
        if (conn) conn.release();
    }
});

// =========== Formularios de Contato ===========
// GET: Buscar configuração do formulário
router.get('/triagem-config/:type', async (req, res) => {
    let conn;
    try {
        const { type } = req.params;
        conn = await pool.getConnection();
        
        // Verifica se existe configuração para este tipo (paciente, empresa, profissional)
        const [rows] = await conn.query("SELECT * FROM triagem_forms_config WHERE form_type = ?", [type]);
        
        if (rows.length > 0) {
            const config = rows[0];
            // Garante que 'fields' seja retornado como JSON (Objeto), não como string
            if (typeof config.fields === 'string') {
                try {
                    config.fields = JSON.parse(config.fields);
                } catch (e) {
                    config.fields = [];
                }
            }
            res.json(serializeBigInts(config));
        } else {
            // Se não existir, retorna um template padrão para o frontend não quebrar
            res.json({
                form_type: type,
                title: `Formulário de ${type.charAt(0).toUpperCase() + type.slice(1)}`,
                description: '',
                fields: []
            });
        }
    } catch (error) {
        console.error('Erro ao buscar config de triagem:', error);
        res.status(500).json({ message: 'Erro interno ao buscar configuração.' });
    } finally {
        if (conn) conn.release();
    }
});

// PUT: Atualizar configuração do formulário
// CORREÇÃO: Usando 'protect' e 'isAdmin' que já existem no seu authMiddleware.js
router.put('/triagem-config/:type', protect, isAdmin, async (req, res) => {
    let conn;
    try {
        const { type } = req.params;
        const { title, description, fields } = req.body;
        
        // Validação básica
        if (!title || !Array.isArray(fields)) {
            return res.status(400).json({ message: 'Dados inválidos. Título e campos (array) são obrigatórios.' });
        }

        conn = await pool.getConnection();
        
        // Converte o array de campos para string JSON para salvar no MySQL
        const fieldsJson = JSON.stringify(fields);

        // Tenta atualizar primeiro
        const [updateResult] = await conn.query(
            "UPDATE triagem_forms_config SET title = ?, description = ?, fields = ? WHERE form_type = ?",
            [title, description, fieldsJson, type]
        );

        // Se não atualizou nenhuma linha (significa que ainda não existe), faz o INSERT
        if (updateResult.affectedRows === 0) {
            await conn.query(
                "INSERT INTO triagem_forms_config (form_type, title, description, fields) VALUES (?, ?, ?, ?)",
                [type, title, description, fieldsJson]
            );
        }

        res.json({ message: 'Configuração do formulário salva com sucesso!' });
    } catch (error) {
        console.error('Erro ao salvar config de triagem:', error);
        res.status(500).json({ message: 'Erro ao salvar configuração.' });
    } finally {
        if (conn) conn.release();
    }
});



module.exports = router;