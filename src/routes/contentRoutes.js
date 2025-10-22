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
        // ================================================================
        // ## VERIFICAÇÃO ADICIONAL E DEFINITIVA AQUI ##
        // Ignora a string exata "[object Object]" que causa o erro.
        // ================================================================
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
    const imageUrl = req.files.image ? req.files.image[0].path.replace(/\\/g, "/") : null;
    const videoUrl = req.files.video ? req.files.video[0].path.replace(/\\/g, "/") : null;
    const post_date = new Date().toISOString().slice(0, 10);

    let conn;
    try {
        conn = await pool.getConnection();
        const result = await conn.query(
            "INSERT INTO blog_posts (title, excerpt, category, paragraphs, post_date, image_url, video_url) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [title, excerpt, category, paragraphs, post_date, imageUrl, videoUrl]
        );
        // ## CORREÇÃO APLICADA AQUI ##
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

        const imageUrl = (req.files && req.files.image) ? req.files.image[0].path.replace(/\\/g, "/") : post.image_url;
        const videoUrl = (req.files && req.files.video) ? req.files.video[0].path.replace(/\\/g, "/") : post.video_url;

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
    const photoUrl = req.files.photo ? req.files.photo[0].path.replace(/\\/g, "/") : null;
    const videoUrl = req.files.video ? req.files.video[0].path.replace(/\\/g, "/") : null;

    let conn;
    try {
        conn = await pool.getConnection();
        const result = await conn.query(
            "INSERT INTO testimonials (quote, name, role, photo_url, video_url) VALUES (?, ?, ?, ?, ?)",
            [quote, name, role, photoUrl, videoUrl]
        );
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
        const photoUrl = req.files.photo ? req.files.photo[0].path.replace(/\\/g, "/") : testimonial.photo_url;
        const videoUrl = req.files.video ? req.files.video[0].path.replace(/\\/g, "/") : testimonial.video_url;
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

    const imageUrl = req.file ? req.file.path.replace(/\\/g, "/") : null;

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
        res.status(201).json({ message: 'Serviço criado com sucesso!', id: String(result.insertId) });
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
        
        const imageUrl = req.file ? req.file.path.replace(/\\/g, "/") : service.image_url;
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
        if (req.file) {
            updateObject.about_image_url = req.file.path.replace(/\\/g, "/");
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
// /src/routes/contentRoutes.js

router.put('/site', protect, isAdmin, upload.fields([
    { name: 'hero_video', maxCount: 1 },
    { name: 'about_logo', maxCount: 1 },
    { name: 'founder_image', maxCount: 1 },
    { name: 'tpt_media', maxCount: 1 },
    { name: 'partner_logos', maxCount: 10 } // Permite até 10 logos de parceiros
]), async (req, res) => {
    
    console.log('[DEBUG-BACKEND] Corpo da requisição recebido:', req.body);

    const sectionsToUpdate = ['home', 'about', 'founder', 'footer'];
    const updatedSectionKey = sectionsToUpdate.find(key => req.body[key]);
    
    if (!updatedSectionKey) {
        return res.status(400).json({ message: 'Nenhuma seção para atualizar foi fornecida no corpo da requisição.' });
    }

    let conn;
    try {
        conn = await pool.getConnection();

        // 1. Pega os dados de texto da requisição.
        let dataToMerge = {};
        const sectionDataString = req.body[updatedSectionKey];
        if (typeof sectionDataString === 'string') {
            try {
                dataToMerge = JSON.parse(sectionDataString);
            } catch (e) {
                return res.status(400).json({ message: `O conteúdo da seção '${updatedSectionKey}' não é um JSON válido.` });
            }
        } else {
             return res.status(400).json({ message: `O conteúdo da seção '${updatedSectionKey}' não foi enviado como uma string JSON.` });
        }
        
        // 2. Adiciona as URLs de arquivos (se houver) ao objeto que será mesclado.
        if (req.files) {
            if (updatedSectionKey === 'home' && req.files.hero_video) {
                dataToMerge.hero_video_url = req.files.hero_video[0].path.replace(/\\/g, "/");
            }
            if (updatedSectionKey === 'home' && req.files.tpt_media) {
                const file = req.files.tpt_media[0];
                dataToMerge.tpt_media_url = file.path.replace(/\\/g, "/");
                dataToMerge.tpt_media_type = file.mimetype.startsWith('video') ? 'video' : 'image';
            }
            if (updatedSectionKey === 'about' && req.files.about_logo) {
                dataToMerge.logo_url = req.files.about_logo[0].path.replace(/\\/g, "/");
            }
            if (updatedSectionKey === 'founder' && req.files.founder_image) {
                dataToMerge.image_url = req.files.founder_image[0].path.replace(/\\/g, "/");
            }
            // Adiciona os novos logos de parceiros, se enviados
            if (updatedSectionKey === 'about' && req.files.partner_logos) {
                const newPartnerUrls = req.files.partner_logos.map(file => file.path.replace(/\\/g, "/"));
                // Combina os logos existentes (que o frontend envia) com os novos
                dataToMerge.partner_logos = [...(dataToMerge.partner_logos || []), ...newPartnerUrls];
            }
        }

        // 3. Monta o objeto final para a query de merge do JSON.
        const updatePayload = {
            [updatedSectionKey]: dataToMerge
        };
        const updatePayloadString = JSON.stringify(updatePayload);

        // 4. Garante que a linha com id=1 exista antes de tentar atualizar (UPSERT)
        const [check] = await conn.query("SELECT id FROM site_content WHERE id = 1");
        if (!check) {
            // Se não existir, insere uma nova linha com o conteúdo atual.
            await conn.query(`INSERT INTO site_content (id, content) VALUES (1, ?)`, [updatePayloadString]);
        } else {
            // Se existir, usa JSON_MERGE_PATCH para mesclar o conteúdo novo com o existente.
            // COALESCE garante que a função não falhe se o campo 'content' for NULL.
            const query = `
                UPDATE site_content 
                SET content = JSON_MERGE_PATCH(COALESCE(content, '{}'), ?) 
                WHERE id = 1
            `;
            await conn.query(query, [updatePayloadString]);
        }
        
        res.json({ message: `Seção '${updatedSectionKey}' atualizada com sucesso!` });

    } catch (error) {
        console.error("Erro ao atualizar conteúdo do site:", error);
        res.status(500).json({ message: 'Erro ao atualizar conteúdo do site.', error: error.message });
    } finally {
        if (conn) conn.release();
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

module.exports = router;