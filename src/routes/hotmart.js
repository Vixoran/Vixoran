import { db } from '../db.js';
import { sendToMetaCAPI, buildMetaEvent, sha256 } from '../services/meta-capi.js';
import { calculateAttribution } from '../services/attribution.js';

const BRAND_TERMS = (process.env.BRAND_TERMS || '').toLowerCase().split(',').filter(Boolean);

const campaignNameCache = {};

async function resolveMetaName(id) {
  if (!id) return null;
  if (campaignNameCache[id]) return campaignNameCache[id];
  const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
  if (!ACCESS_TOKEN) return id;
  try {
    const res = await fetch(
      'https://graph.facebook.com/v19.0/' + id + '?fields=name&access_token=' + ACCESS_TOKEN
    );
    const data = await res.json();
    if (data.name) {
      campaignNameCache[id] = data.name;
      return data.name;
    }
  } catch (e) {}
  return id;
}

export async function hotmartRoutes(fastify) {

  fastify.post('/hotmart/webhook', async (req, reply) => {
    const payload = req.body;

    const eventType = payload?.event || payload?.data?.purchase?.status;
    const isApproved =
      eventType === 'PURCHASE_APPROVED' ||
      eventType === 'PURCHASE_COMPLETE' ||
      payload?.data?.purchase?.status === 'APPROVED' ||
      payload?.data?.purchase?.status === 'COMPLETE';

    if (!isApproved) {
      console.log('Hotmart evento ignorado: ' + eventType);
      return reply.send({ ok: true, ignored: true });
    }

    const purchase = payload?.data?.purchase || payload?.purchase || {};
    const buyer    = payload?.data?.buyer    || payload?.buyer    || {};
    const product  = payload?.data?.product  || payload?.product  || {};

    const transaction = purchase.transaction || purchase.order_date || payload.id;
    const revenue     = parseFloat(purchase.price?.value || purchase.value || 0);
    const currency    = purchase.price?.currency_value || 'BRL';
    const email       = (buyer.email || '').toLowerCase().trim();
    const name        = buyer.name || '';
    const productId   = product.id?.toString() || '';
    const productName = product.name || '';

    const tracking = purchase.tracking || payload?.data?.tracking || {};
    const utmSource   = tracking.source_sck || tracking.utm_source || '';
    const utmMedium   = tracking.medium || tracking.utm_medium || '';
    const utmContent  = tracking.content || tracking.utm_content || '';
    const utmTerm     = tracking.term || tracking.utm_term || '';
    const fbclid      = tracking.fbclid || '';
    const gclid       = tracking.gclid || '';

    // VID vem no parâmetro _vx_vid que o tracker injeta nos links
    const vid = tracking._vx_vid || '';

    // fbp vem no campo src que injetamos no link do Hotmart
    const fbp = tracking.source_sck || tracking.src || '';

    let utmCampaign = tracking.campaign || tracking.utm_campaign || '';
    const isNumericCampaign = /^\d+$/.test(utmCampaign);

    if (isNumericCampaign) {
      const resolved = await resolveMetaName(utmCampaign);
      utmCampaign = resolved || utmCampaign;
    }

    const channel       = detectChannel({ utmSource, utmMedium, fbclid, gclid });
    const isBrandSearch = detectBrandSearch({ utmSource, utmMedium, utmTerm });
    const emailHash     = email ? await sha256(email) : null;

    const { rows } = await db.query(
      'INSERT INTO purchases (' +
      'hotmart_transaction, product_id, product_name,' +
      'buyer_email_hash, buyer_name, revenue, currency,' +
      'utm_source, utm_medium, utm_campaign, utm_content, utm_term,' +
      'fbclid, fbp, gclid,' +
      'channel, is_brand_search,' +
      'raw_payload' +
      ') VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)' +
      ' ON CONFLICT (hotmart_transaction) DO NOTHING' +
      ' RETURNING id',
      [
        transaction, productId, productName,
        emailHash, name, revenue, currency,
        utmSource, utmMedium, utmCampaign, utmContent, vid || utmTerm,
        fbclid, fbp, gclid,
        channel, isBrandSearch,
        payload,
      ]
    );

    if (rows.length === 0) {
      console.log('Transacao duplicada: ' + transaction);
      return reply.send({ ok: true, duplicate: true });
    }

    const { attribution } = await calculateAttribution(emailHash, null, revenue, new Date());

    if (Object.keys(attribution).length > 0) {
      await db.query(
        'UPDATE purchases SET attribution = $1 WHERE hotmart_transaction = $2',
        [attribution, transaction]
      );
    }

    const metaEvent = buildMetaEvent({
      eventName: 'Purchase',
      eventId: 'hotmart_' + transaction,
      userData: { em: emailHash, fbp, fbc: fbclid },
      customData: {
        value: revenue,
        currency,
        order_id: transaction,
        content_ids: [productId],
        content_name: productName,
      },
      sourceUrl: process.env.SITE_URL || '',
      clientIp: req.ip,
      clientUserAgent: req.headers['user-agent'],
    });

    const metaResult = await sendToMetaCAPI(metaEvent);

    await db.query(
      'UPDATE purchases SET meta_capi_sent = true, meta_capi_response = $1 WHERE hotmart_transaction = $2',
      [metaResult, transaction]
    );

    console.log('Compra: ' + transaction + ' | ' + channel + ' | ' + utmCampaign + ' | R$ ' + revenue);
    return reply.send({ ok: true, channel, campaign: utmCampaign, attribution });
  });
}

function detectChannel({ utmSource, utmMedium, fbclid, gclid }) {
  if (fbclid) return 'meta';
  if (gclid)  return 'google';
  const src = utmSource.toLowerCase();
  const med = utmMedium.toLowerCase();
  if (src.includes('facebook') || src.includes('instagram') || src.includes('meta')) return 'meta';
  if (src.includes('google') || src.includes('bing')) return 'google';
  if (med === 'email') return 'email';
  if (med === 'organic') return 'organic';
  if (src) return 'other';
  return 'direct';
}

function detectBrandSearch({ utmSource, utmMedium, utmTerm }) {
  if (BRAND_TERMS.length === 0) return false;
  const isGoogle = utmSource.toLowerCase().includes('google');
  const isCPC    = utmMedium.toLowerCase() === 'cpc';
  const term     = utmTerm.toLowerCase();
  return isGoogle && isCPC && BRAND_TERMS.some(t => term.includes(t));
}
