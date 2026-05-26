import pg from 'pg';
const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL não definida nas variáveis de ambiente');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Postgres pool error:', err.message);
});

// Testa conexão na inicialização
pool.query('SELECT 1').then(() => {
  console.log('✅ Postgres conectado');
}).catch(err => {
  console.error('❌ Falha ao conectar no Postgres:', err.message);
  process.exit(1);
});

export const db = {
  query: (text, params) => pool.query(text, params),
};
