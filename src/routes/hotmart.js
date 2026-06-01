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
  } catch (e) {
    console.error('Erro ao resolver nome Meta:', e.message);
  }

  return id;
}

// Extrai o VID (v_...) de uma string que pode ter o prefixo _VID_ ou não
function extractVid(str) {
  if (!str) return '';

  const value = String(str);

  const idx = value.indexOf('_VID_');

  if (idx !== -1) {
    const after = value.slice(idx + 5); // 5 = tamanho de "_VID_"
    return after.startsWith('v_') ? after : '';
  }

  return value.startsWith('v_') ? value : '';
}

// Remove o trecho _VID_v_... de uma string, devolvendo o que sobra
function stripVid(str) {
  if (!str) return '';

  const value = String(str);
  const idx = value.indexOf('_VID_');

  return idx !== -1 ? value.slice(0, idx) : value;
}

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

function getTrackingObjects(payload, purchase) {
  const tracking =
    purchase?.tracking ||
    payload?.data?.tracking ||
    payload?.tracking ||
    {};

  const origin =
    purchase?.origin ||
    payload?.data?.purchase?.origin ||
    payload?.data?.origin ||
    payload?.origin ||
    {};

  const checkout =
    purchase?.checkout ||
    payload?.data?.purchase?.checkout ||
    payload?.data?.checkout ||
    payload?.checkout ||
    {};

  return { tracking, origin, checkout };
}

function extractSck({ tracking, origin, checkout, payload }) {
  return firstFilled(
    origin.sck,
    origin.SCK,

    tracking.sck,
    tracking.SCK,
    tracking.source_sck,

    checkout.sck,
    checkout.SCK,

    payload?.data?.sck,
    payload?.sck
  );
}

function buildCheckoutParams({ tracking, origin, checkout }) {
  return {
    tracking,
    origin,
    checkout
  };
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
    const buyer = payload?.data?.buyer || payload?.buyer || {};
    const product = payload?.data?.product || payload?.product || {};

    const transaction = purchase.transaction || purchase.order_date || payload.id;
    const revenue = parseFloat(purchase.price?.value || purchase.value || 0);
    const currency = purchase.price?.currency_value || 'BRL';

    const email = (buyer.email || '').toLowerCase().trim();
    const name = buyer.name || '';

    const productId = product.id?.toString() || '';
    const productName = product.name || '';

    const { tracking, origin, checkout } = getTrackingObjects(payload, purchase);

    const sck = extractSck({ tracking, origin, checkout, payload });

    const utmSource = firstFilled(
      tracking.utm_source,
      tracking.source,
      tracking.source_sck
    );

    const utmMedium = firstFilled(
      tracking.utm_medium,
      tracking.medium
    );

    const utmContent = firstFilled(
      tracking.utm_content,
      tracking.content
    );

    const rawUtmTerm = firstFilled(
      tracking.utm_term,
      tracking.term
    );

    const fbclid = firstFilled(
      tracking.fbclid,
      origin.fbclid,
      checkout.fbclid
    );

    const gclid = firstFilled(
      tracking.gclid,
      origin.gclid,
      checkout.gclid
    );

    // O VID pode chegar no src OU no utm_term, com prefixo _VID_
    const rawSrc = firstFilled(
      origin.src,
      tracking.src,
      checkout.src
    );

    const vid =
      extractVid(rawSrc) ||
      extractVid(rawUtmTerm) ||
      extractVid(utmContent) ||
      extractVid(sck);

    // fbp = src sem a parte do VID
    const fbp = stripVid(rawSrc);

    // utm_term limpo: se tinha _VID_, remove; senão mantém o original
    const utmTerm = stripVid(rawUtmTerm);

    let utmCampaign = firstFilled(
      tracking.utm_campaign,
      tracking.campaign
    );

    const isNumericCampaign = /^\d+$/.test(utmCampaign);

    if (isNumericCampaign) {
      const resolved = await resolveMetaName(utmCampaign);
      utmCampaign = resolved || utmCampaign;
    }

    const channel = detectChannel({ utmSource, utmMedium, fbclid, gclid, sck });
    const isBrandSearch = detectBrandSearch({ utmSource, utmMedium, utmTerm });
    const emailHash = email ? await sha256(email) : null;

    // Salva o VID se tiver, senão o utm_term limpo
    const termToSave = vid || utmTerm;

    const checkoutParams = buildCheckoutParams({ tracking, origin, checkout });

    const { rows } = await db.query(
      'INSERT INTO purchases (' +
        'hotmart_transaction, product_id, product_name,' +
        'buyer_email_hash, buyer_name, revenue, currency,' +
        'utm_source, utm_medium, utm_campaign, utm_content, utm_term,' +
        'fbclid, fbp, gclid,' +
        'channel, is_brand_search,' +
        'sck, checkout_params, raw_payload' +
      ') VALUES (' +
        '$1,$2,$3,' +
        '$4,$5,$6,$7,' +
        '$8,$9,$10,$11,$12,' +
        '$13,$14,$15,' +
        '$16,$17,' +
        '$18,$19,$20' +
      ')' +
      ' ON CONFLICT (hotmart_transaction) DO NOTHING' +
      ' RETURNING id',
      [
        transaction,
        productId,
        productName,

        emailHash,
        name,
        revenue,
        currency,

        utmSource,
        utmMedium,
        utmCampaign,
        utmContent,
        termToSave,

        fbclid,
        fbp,
        gclid,

        channel,
        isBrandSearch,

        sck,
        checkoutParams,
        payload
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
      userData: {
        em: emailHash,
        fbp,
        fbc: fbclid
      },
      customData: {
        value: revenue,
        currency,
        order_id: transaction,
        content_ids: [productId],
        content_name: productName
      },
      sourceUrl: process.env.SITE_URL || '',
      clientIp: req.ip,
      clientUserAgent: req.headers['user-agent']
    });

    const metaResult = await sendToMetaCAPI(metaEvent);

    await db.query(
      'UPDATE purchases SET meta_capi_sent = true, meta_capi_response = $1 WHERE hotmart_transaction = $2',
      [metaResult, transaction]
    );

    console.log(
      'Compra: ' +
        transaction +
        ' | canal:' +
        channel +
        ' | campanha:' +
        utmCampaign +
        ' | sck:' +
        sck +
        ' | vid:' +
        vid +
        ' | fbp:' +
        fbp +
        ' | R$ ' +
        revenue
    );

    return reply.send({
      ok: true,
      channel,
      campaign: utmCampaign,
      vid,
      sck,
      attribution
    });
  });
}

function detectChannel({ utmSource, utmMedium, fbclid, gclid, sck }) {
  const src = (utmSource || '').toLowerCase();
  const med = (utmMedium || '').toLowerCase();
  const sckValue = (sck || '').toLowerCase();

  if (fbclid) return 'meta';

  if (sckValue) {
    if (sckValue.startsWith('ig')) return 'meta';
    if (sckValue.startsWith('fb')) return 'meta';
    if (sckValue.startsWith('meta')) return 'meta';
    if (sckValue.startsWith('an')) return 'meta';

    if (sckValue.startsWith('gg')) return 'google';
    if (sckValue.startsWith('google')) return 'google';

    if (sckValue.startsWith('yt')) return 'other';

    if (sckValue.startsWith('wa')) return 'whatsapp';
    if (sckValue.startsWith('wpp')) return 'whatsapp';
    if (sckValue.includes('whatsapp')) return 'whatsapp';
  }

  if (
    src.includes('facebook') ||
    src.includes('instagram') ||
    src.includes('meta') ||
    src === 'fb' ||
    src === 'ig'
  ) {
    return 'meta';
  }

  if (gclid && src !== 'direct') return 'google';

  if (src.includes('google') || src.includes('bing')) return 'google';

  if (med === 'email') return 'email';
  if (med === 'organic') return 'organic';
  if (src) return 'other';

  return 'direct';
}

function detectBrandSearch({ utmSource, utmMedium, utmTerm }) {
  if (BRAND_TERMS.length === 0) return false;

  const isGoogle = utmSource.toLowerCase().includes('google');
  const isCPC = utmMedium.toLowerCase() === 'cpc';
  const term = utmTerm.toLowerCase();

  return isGoogle && isCPC && BRAND_TERMS.some(t => term.includes(t));
}
