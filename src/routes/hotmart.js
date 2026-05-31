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
    const origin   = purchase.origin   || payload?.data?.purchase?.origin || {};

    const utmSource   = tracking.source_sck || tracking.utm_source || '';
    const utmMedium   = tracking.medium || tracking.utm_medium || '';
    const utmContent  = tracking.content || tracking.utm_content || '';
    const utmTerm     = tracking.term || tracking.utm_term || '';
    const fbclid      = tracking.fbclid || '';
    const gclid       = tracking.gclid || '';

    // sck identifica origem do clique (IG = Instagram Stories, FB = Facebook, etc)
    const sck = origin.sck || tracking.sck || tracking.source_sck || '';

    // src pode trazer "fbp|vid". Separa os dois.
    const rawSrc = tracking.src || '';
    const srcParts = rawSrc.split('|');
    const fbp = srcParts[0] || '';
    const vidFromSrc = srcParts[1] || '';

    // VID: primeiro tenta do src, senão do utm_content (compatível com o antigo)
    const vid = vidFromSrc || ((utmContent && utmContent.startsWith('v_')) ? utmContent : '');

    let utmCampaign = tracking.campaign || tracking.utm_campaign || '';
    const isNumericCampaign = /^\d+$/.test(utmCampaign);

    if (isNumericCampaign) {
      const resolved = await resolveMetaName(utmCampaign);
      utmCampaign = resolved || utmCampaign;
    }

    const channel       = detectChannel({ utmSource, utmMedium, fbclid, gclid, sck });
    const isBrandSearch = detectBrandSearch({ utmSource, utmMedium, utmTerm });
    const emailHash     = email ? await sha256(email) : null;

    // Usa vid se disponível, senão utm_term original
    const termToSave = vid || utmTerm;

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
        utmSource, utmMedium, utmCampaign, utmContent, termToSave,
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

    console.log('Compra: ' + transaction + ' | ' + channel + ' | ' + utmCampaign + ' | sck:' + sck + ' | R$ ' + revenue);
    return reply.send({ ok: true, channel, campaign: utmCampaign, attribution });
  });
}

function detectChannel({ utmSource, utmMedium, fbclid, gclid, sck }) {
  const src = (utmSource || '').toLowerCase();
  const med = (utmMedium || '').toLowerCase();

  // fbclid é prova forte de Meta
  if (fbclid) return 'meta';

  // sck identifica origem específica (vem da Hotmart)
  if (sck) {
    if (sck.startsWith('IG')) return 'meta';   // Instagram
    if (sck.startsWith('FB')) return 'meta';   // Facebook
    if (sck.startsWith('YT')) return 'other';  // YouTube
    if (sck.startsWith('WA')) return 'other';  // WhatsApp
  }

  // UTM de Meta
  if (src.includes('facebook') || src.includes('instagram') || src.includes('meta') || src === 'fb' || src === 'ig') return 'meta';

  // gclid só vira google se a fonte NÃO contradiz (evita gclid sujo em links direct)
  if (gclid && src !== 'direct') return 'google';

  // UTM de Google
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
