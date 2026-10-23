const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Migração aplicada com sucesso.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Erro na migração:', err);
  process.exit(1);
});
