import { db } from '../db.js';
import { calculateAttribution } from '../services/attribution.js';

export async function attributionRoutes(fastify) {

  // Relatório por canal
  fastify.get('/attribution/report', async (req, reply) => {
    const days = parseInt(req.query.days || '30');

    const { rows } = await db.query(
      `SELECT
         channel,
         COUNT(*) as purchases,
         SUM(revenue) as total_revenue,
         COUNT(*) FILTER (WHERE is_brand_search) as brand_search_corrections
       FROM purchases
       WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
       GROUP BY channel
       ORDER BY total_revenue DESC`,
      [days]
    );

    return reply.send({ period_days: days, by_channel: rows });
  });

  // Relatório por campanha
  fastify.get('/attribution/campaigns', async (req, reply) => {
    const days = parseInt(req.query.days || '30');

    const { rows } = await db.query(
      `SELECT
         utm_campaign,
         utm_source,
         channel,
         COUNT(*) as purchases,
         SUM(revenue) as total_revenue,
         AVG(revenue) as avg_ticket
       FROM purchases
       WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
         AND utm_campaign IS NOT NULL
       GROUP BY utm_campaign, utm_source, channel
       ORDER BY total_revenue DESC`,
      [days]
    );

    return reply.send({ period_days: days, campaigns: rows });
  });

  // Jornada de um visitante
  fastify.get('/attribution/journey/:vid', async (req, reply) => {
    const { rows: touchpoints } = await db.query(
      `SELECT * FROM touchpoints WHERE vid = $1 ORDER BY touched_at ASC`,
      [req.params.vid]
    );
    const { rows: events } = await db.query(
      `SELECT event_name, event_time, custom_data FROM events
       WHERE vid = $1 ORDER BY event_time ASC`,
      [req.params.vid]
    );
    return reply.send({ touchpoints, events });
  });

  // Detalhe de uma compra
  fastify.get('/attribution/purchase/:transaction', async (req, reply) => {
    const { rows } = await db.query(
      `SELECT * FROM purchases WHERE hotmart_transaction = $1`,
      [req.params.transaction]
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'Não encontrado' });
    return reply.send(rows[0]);
  });
}
