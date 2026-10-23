const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
let pool;

if (process.env.DS100_PGLITE) {
  // Só para testes automáticos: base de dados Postgres em memória (sem instalar nada).
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  const q = async (text, params) => {
    if (!params) {
      const rs = await db.exec(text);
      const r = rs[rs.length - 1] || { rows: [] };
      return { rows: r.rows, rowCount: r.rows.length };
    }
    const r = await db.query(text, params);
    return { rows: r.rows, rowCount: r.rows.length || r.affectedRows || 0 };
  };
  pool = { query: q, connect: async () => ({ query: q, release() {} }), end: () => db.close() };
} else {
  pool = new Pool(
    connectionString
      ? { connectionString, ssl: /localhost|railway\.internal/.test(connectionString) ? false : { rejectUnauthorized: false } }
      : {
          host: process.env.PGHOST || 'localhost',
          port: process.env.PGPORT || 5432,
          user: process.env.PGUSER || 'postgres',
          password: process.env.PGPASSWORD || 'postgres',
          database: process.env.PGDATABASE || 'ds100',
        }
  );
}

module.exports = pool;
