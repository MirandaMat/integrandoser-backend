// server/src/config/db.js
const mariadb = require('mariadb');
// dotenv removed as index.js handles it

let pool; // Declare pool outside try block

try {
  // --- START: Added Logs ---
  console.log('[DB_INIT] Attempting to create database pool...');
  const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD ? '******' : undefined, // Mask password
    database: process.env.DB_DATABASE,
    port: parseInt(process.env.DB_PORT || 3306),
    connectionLimit: 5
  };
  console.log('[DB_INIT] Using config:', JSON.stringify(dbConfig));
  // --- END: Added Logs ---

  pool = mariadb.createPool({ // Assign to pool declared outside
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    port: parseInt(process.env.DB_PORT || 3306),
    connectionLimit: 5
  });

  // --- START: Added Logs ---
  console.log('[DB_INIT] Database pool CREATED successfully.');
  // Optional: Test connection immediately - uncomment if needed
  /*
  pool.getConnection()
    .then(conn => {
      console.log('[DB_INIT] Initial test connection successful.');
      conn.release();
    })
    .catch(err => {
      console.error('[DB_INIT] FAILED initial test connection:', err);
    });
  */
  // --- END: Added Logs ---

} catch (error) {
  // --- START: Added Logs ---
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  console.error('[DB_INIT] CRITICAL ERROR during pool creation:', error);
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  // Re-throw error to ensure Railway logs it as a crash
  throw error;
  // --- END: Added Logs ---
}

// Check if pool was created before exporting
if (!pool) {
  console.error('[DB_INIT] ERROR: Pool variable is still undefined after try block.');
  throw new Error('Database pool could not be initialized.');
}

console.log('[DB_INIT] Exporting database pool...'); // Log before export
module.exports = pool;