// Corre toda a bateria de testes: npm test
// Usa uma base de dados em memória (pglite) e arranca o servidor no mesmo processo.
// Para testar contra um Postgres real: DATABASE_URL=... TEST_REAL_DB=1 npm test
const { spawn } = require('child_process');
const path = require('path');
const env = { ...process.env, PORT: '3199', TEST_BASE: 'http://localhost:3199' };
if (!process.env.TEST_REAL_DB) env.DS100_PGLITE = '1';
const t = spawn('node', ['--test', '--test-force-exit', '--experimental-test-isolation=none', '--require', './tests/setup.js', 'tests/*.test.js'],
  { env, cwd: path.join(__dirname, '..'), stdio: 'inherit' });
t.on('exit', (code) => process.exit(code));
