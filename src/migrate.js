import { readFileSync } from 'fs';
import { db } from './db.js';

const sql = readFileSync(new URL('./migrations/001_init.sql', import.meta.url), 'utf8');

try {
  await db.query(sql);
  console.log('✅ Tabelas criadas com sucesso');
} catch (err) {
  console.error('❌ Erro na migration:', err.message);
  process.exit(1);
}

process.exit(0);
