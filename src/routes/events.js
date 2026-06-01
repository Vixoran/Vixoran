import { db } from '../db.js';
import { sendToMetaCAPI, buildMetaEvent } from '../services/meta-capi.js';

const BRAND_TERMS = (process.env.BRAND_TERMS || '').toLowerCase().split(',').filter(Boolean);

function clean(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function firstFilled(...values) {
  for (const value of values) {
    const cleaned = clean(value);
    if (cleaned) return cleaned;
  }

  return '';
}

function pickCampaignId(body) {
  return firstFilled(
    body.campaign_id,
    body.fb_campaign_id,
    body.meta_campaign_id,
    body.campaignId,
    body.utm_campaign_id
  );
}

function pickAdsetId(body) {
  return firstFilled(
    body.adset_id,
    body.fb_adset_id,
    body.meta_adset_id,
    body.adsetId,

    // Compatibilidade com UTM antiga da Hyros:
    // fbc_id={{adset.id}}
    body.fbc_id
  );
}

function pickAdId(body) {
  return firstFilled(
    body.ad_id,
    body.fb_ad_id,
    body.meta_ad_id,
    body.adId,

    // Compatibilidade com UTM antiga da Hyros:
    // h_ad_id={{ad.id}}
    body.h_ad_id
  );
}

function limitText(value, max = 5000) {
  const cleaned = clean(value);
  if (!cleaned) return null;
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
}

export async function eventsRoutes(fastify) {
  // Registra touchpoint quando visitante chega ao site
  fastify.post('/touchpoint', async (req, reply) => {
    const body = req.body || {};

    const campaignId = pickCampaignId(body);
    const adsetId = pickAdsetId(body);
    const adId = pickAdId(body);

    const channel = detectChannel(body);
    const isBrandSearch = detectBrandSearch(body);

    await db.query(
      `INSERT INTO touchpoints (
        vid, user_hash, session_id,
        channel, source, medium, campaign, campaign_id, adset_id, ad_id,
        gclid, fbclid, fbp, fbc,
        is_brand_search, landing_page, referrer, user_agent
      ) VALUES (
        $1,$2,$3,
        $4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,
        $15,$16,$17,$18
      )`,
      [
        limitText(body.vid, 100),
        limitText(body.user_hash, 255),
        limitText(body.session_id, 255),

        channel,
        limitText(body.utm_source, 255),
        limitText(body.utm_medium, 255),
        limitText(body.utm_campaign, 5000),
        limitText(campaignId, 5000),
        limitText(adsetId, 5000),
        limitText(adId, 5000),

        limitText(body.gclid, 5000),
        limitText(body.fbclid, 5000),
        limitText(body.fbp, 5000),
        limitText(body.fbc, 5000),

        isBrandSearch,
        limitText(body.landing_page, 5000),
        limitText(body.referrer, 5000),
        limitText(req.headers['user-agent'], 5000)
      ]
    );

    return reply.send({
      ok: true,
      channel,
      is_brand_search: isBrandSearch,
      campaign_id: campaignId || null,
      adset_id: adsetId || null,
      ad_id: adId || null
    });
  });

  // Evento de conversão do pixel (Lead, InitiateCheckout, etc.)
  fastify.post('/events', async (req, reply) => {
    const body = req.body || {};

    const { rows } = await db.query(
      `INSERT INTO events (
        event_id, event_name, event_time, vid, user_hash,
        session_id, source, custom_data, raw_payload
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (event_id) DO NOTHING
      RETURNING id`,
      [
        body.event_id,
        body.event_name,
        body.event_time ? new Date(body.event_time * 1000) : new Date(),
        body.vid || null,
        body.user_data?.em || null,
        body.session_id || null,
        'pixel',
        body.custom_data || {},
        body
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
      clientUserAgent: req.headers['user-agent']
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

  if (
    src.includes('facebook') ||
    src.includes('instagram') ||
    src.includes('meta') ||
    src === 'fb' ||
    src === 'ig'
  ) {
    return 'meta';
  }

  if (src.includes('google')) return 'google';
  if (med === 'email') return 'email';

  if (med === 'organic') return 'organic';
  if (src) return 'other';

  return 'direct';
}

function detectBrandSearch(body) {
  if (BRAND_TERMS.length === 0) return false;

  const isGoogle = (body.utm_source || '').toLowerCase().includes('google');
  const isCPC = (body.utm_medium || '').toLowerCase() === 'cpc';
  const term = (body.utm_term || '').toLowerCase();

  return isGoogle && isCPC && BRAND_TERMS.some(t => term.includes(t));
}