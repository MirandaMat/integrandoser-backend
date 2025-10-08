// server/src/hashPassword.js
const bcrypt = require('bcryptjs');

const password = 'admin_password'; // Mantenha a senha que você escolheu
const salt = bcrypt.genSaltSync(10);
const hash = bcrypt.hashSync(password, salt);

console.log('Senha original:', password);
console.log('Hash gerado:', hash);
