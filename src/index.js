import Fastify from 'fastify';
import cors from '@fastify/cors';
import { hotmartRoutes } from './routes/hotmart.js';
import { eventsRoutes } from './routes/events.js';
import { engagementRoutes } from './routes/engagement.js';
import { attributionRoutes } from './routes/attribution.js';
import { db } from './db.js';
const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
// Autenticação via header — exceto webhook da Hotmart (ela não manda o header)
app.addHook('onRequest', async (req, reply) => {
  if (req.url === '/health') return;
  if (req.url.startsWith('/api/hotmart/webhook')) return; // Hotmart não manda secret
  if (req.url.startsWith('/api/engagement')) return; // sendBeacon não manda header
  const secret = req.headers['x-api-secret'];
  if (secret !== process.env.API_SECRET) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
});
app.get('/health', async () => ({
  status: 'ok',
  time: new Date().toISOString(),
}));
app.register(hotmartRoutes,    { prefix: '/api' });
app.register(eventsRoutes,     { prefix: '/api' });
app.register(engagementRoutes, { prefix: '/api' });
app.register(attributionRoutes,{ prefix: '/api' });
// Roda migrations e sobe o servidor
try {
  const { readFileSync } = await import('fs');
  const sql = readFileSync(new URL('./migrations/001_init.sql', import.meta.url), 'utf8');
  await db.query(sql);
  console.log('✅ Banco pronto');
} catch (err) {
  console.error('Erro na migration:', err.message);
}
const PORT = parseInt(process.env.PORT || '3000');
await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`🚀 Vixoran Attribution rodando na porta ${PORT}`);
