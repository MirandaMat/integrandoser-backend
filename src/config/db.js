// server/src/config/db.js
const mariadb = require('mariadb');

let pool; 

try {
  console.log('[DB_INIT] Attempting to create database pool...');
  
  // Define o fuso horário padrão do Brasil
  const appTimezone = process.env.TZ || 'America/Sao_Paulo';

  // Vamos logar a configuração exata que será usada
  const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD ? '******' : undefined, // Mask password
    database: process.env.DB_DATABASE,
    port: parseInt(process.env.DB_PORT || 3306),
    connectionLimit: 5,
    allowPublicKeyRetrieval: true,
    timezone: appTimezone // <-- ADICIONADO AQUI
  };
  console.log('[DB_INIT] Using config:', JSON.stringify(dbConfig));

  pool = mariadb.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    port: parseInt(process.env.DB_PORT || 3306),
    connectionLimit: 5,
    allowPublicKeyRetrieval: true, 
    timezone: appTimezone
  });

  console.log('[DB_INIT] Database pool CREATED successfully.');

} catch (error) {
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  console.error('[DB_INIT] CRITICAL ERROR during pool creation:', error);
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  throw error;
}

if (!pool) {
  console.error('[DB_INIT] ERROR: Pool variable is still undefined after try block.');
  throw new Error('Database pool could not be initialized.');
}

console.log('[DB_INIT] Exporting database pool...');
module.exports = pool;