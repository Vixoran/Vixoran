import { db } from '../db.js';
import { sendToMetaCAPI, buildMetaEvent } from '../services/meta-capi.js';

const BRAND_TERMS = (process.env.BRAND_TERMS || '').toLowerCase().split(',').filter(Boolean);

export async function eventsRoutes(fastify) {

  // Registra touchpoint quando visitante chega ao site
  fastify.post('/touchpoint', async (req, reply) => {
    const body = req.body;
    const channel = detectChannel(body);
    const isBrandSearch = detectBrandSearch(body);

    await db.query(
      `INSERT INTO touchpoints (
        vid, user_hash, session_id,
        channel, source, medium, campaign, campaign_id, ad_id,
        gclid, fbclid, fbp, fbc,
        is_brand_search, landing_page, referrer, user_agent
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        body.vid, body.user_hash || null, body.session_id,
        channel, body.utm_source || null, body.utm_medium || null,
        body.utm_campaign || null, body.campaign_id || null, body.ad_id || null,
        body.gclid || null, body.fbclid || null, body.fbp || null, body.fbc || null,
        isBrandSearch, body.landing_page || null, body.referrer || null,
        req.headers['user-agent'] || null,
      ]
    );

    return reply.send({ ok: true, channel, is_brand_search: isBrandSearch });
  });

  // Evento de conversão do pixel (Lead, InitiateCheckout, etc.)
  fastify.post('/events', async (req, reply) => {
    const body = req.body;

    const { rows } = await db.query(
      `INSERT INTO events (
        event_id, event_name, event_time, vid, user_hash,
        session_id, source, custom_data, raw_payload
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (event_id) DO NOTHING
      RETURNING id`,
      [
        body.event_id, body.event_name,
        body.event_time ? new Date(body.event_time * 1000) : new Date(),
        body.vid || null, body.user_data?.em || null,
        body.session_id || null, 'pixel',
        body.custom_data || {}, body,
      ]
    );

    if (rows.length === 0) return reply.send({ ok: true, duplicate: true });

    // Envia para Meta CAPI
    const metaEvent = buildMetaEvent({
      eventName: body.event_name,
      eventId: body.event_id,
      userData: body.user_data || {},
      customData: body.custom_data || {},
      sourceUrl: body.event_source_url,
      clientIp: req.ip,
      clientUserAgent: req.headers['user-agent'],
    });

    const metaResult = await sendToMetaCAPI(metaEvent);

    await db.query(
      `UPDATE events SET meta_sent = true, meta_response = $1, meta_sent_at = NOW()
       WHERE event_id = $2`,
      [metaResult, body.event_id]
    );

    return reply.send({ ok: true });
  });
}

function detectChannel(body) {
  if (body.fbclid || body.fbc) return 'meta';
  if (body.gclid) return 'google';
  const src = (body.utm_source || '').toLowerCase();
  const med = (body.utm_medium || '').toLowerCase();
  if (src.includes('facebook') || src.includes('instagram')) return 'meta';
  if (src.includes('google')) return 'google';
  if (med === 'email') return 'email';
  return 'direct';
}

function detectBrandSearch(body) {
  if (BRAND_TERMS.length === 0) return false;
  const isGoogle = (body.utm_source || '').toLowerCase().includes('google');
  const isCPC    = (body.utm_medium || '').toLowerCase() === 'cpc';
  const term     = (body.utm_term || '').toLowerCase();
  return isGoogle && isCPC && BRAND_TERMS.some(t => term.includes(t));
}
