// Arranca o servidor (e a migração) antes dos testes e termina o processo no fim.
require('../server');
const { before, after } = require('node:test');
before(() => new Promise((r) => setTimeout(r, 2500)));
after(() => { setTimeout(() => process.exit(process.exitCode || 0), 300); });
