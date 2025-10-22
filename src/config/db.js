// server/src/config/db.js
const mariadb = require('mariadb');
//const dotenv = require('dotenv');

//dotenv.config();

const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  port: parseInt(process.env.DB_PORT || 3306),
  connectionLimit: 5
});

module.exports = pool; // Use module.exports em vez de export default