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

// Extrai o VID (v_...) de uma string que pode ter o prefixo _VID_ ou não
function extractVid(str) {
  if (!str) return '';

  const value = String(str);

  const idx = value.indexOf('_VID_');

  if (idx !== -1) {
    const after = value.slice(idx + 5);
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

function findDeepValue(obj, keys = [], maxDepth = 8) {
  if (!obj || typeof obj !== 'object' || maxDepth < 0) return '';

  const wanted = keys.map(k => k.toLowerCase());

  for (const [key, value] of Object.entries(obj)) {
    if (wanted.includes(String(key).toLowerCase())) {
      const cleaned = clean(value);
      if (cleaned) return cleaned;
    }
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      const found = findDeepValue(value, keys, maxDepth - 1);
      if (found) return found;
    }
  }

  return '';
}

function collectDeepStrings(obj, maxDepth = 8, output = []) {
  if (obj === null || obj === undefined || maxDepth < 0) return output;

  if (typeof obj === 'string') {
    output.push(obj);
    return output;
  }

  if (typeof obj !== 'object') return output;

  for (const value of Object.values(obj)) {
    collectDeepStrings(value, maxDepth - 1, output);
  }

  return output;
}

function extractQueryParamFromText(text, param) {
  if (!text) return '';

  const value = String(text);

  try {
    if (value.startsWith('http://') || value.startsWith('https://')) {
      const url = new URL(value);
      return clean(url.searchParams.get(param));
    }
  } catch (e) {}

  const regex = new RegExp(`[?&]${param}=([^&#\\s]+)`, 'i');
  const match = value.match(regex);

  if (!match?.[1]) return '';

  try {
    return decodeURIComponent(match[1]);
  } catch (e) {
    return match[1];
  }
}

function findQueryParamAnywhere(payload, param) {
  const strings = collectDeepStrings(payload);

  for (const text of strings) {
    const found = extractQueryParamFromText(text, param);
    if (found) return found;
  }

  return '';
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
    payload?.sck,

    findDeepValue(payload, ['sck', 'SCK', 'source_sck']),
    findQueryParamAnywhere(payload, 'sck')
  );
}

function extractParam({ tracking, origin, checkout, payload, keys = [], queryParam }) {
  return firstFilled(
    ...keys.map(key => tracking?.[key]),
    ...keys.map(key => origin?.[key]),
    ...keys.map(key => checkout?.[key]),
    findDeepValue(payload, keys),
    queryParam ? findQueryParamAnywhere(payload, queryParam) : ''
  );
}

function buildCheckoutParams({ tracking, origin, checkout }) {
  return {
    tracking,
    origin,
    checkout
  };
}

function classifySck(sck) {
  const value = (sck || '').toLowerCase();

  if (!value) return 'sem_sck';

  if (value.includes('ig_bio') || value.includes('bio')) return 'instagram_bio';
  if (value.includes('ig_story') || value.includes('story')) return 'instagram_story';
  if (value.includes('ig_dm') || value.includes('direct')) return 'instagram_dm';

  if (value.startsWith('ig')) return 'instagram';
  if (value.startsWith('fb')) return 'facebook';
  if (value.startsWith('meta')) return 'meta';
  if (value.startsWith('an')) return 'meta_audience_network';

  if (value.startsWith('gg') || value.startsWith('google')) return 'google';

  if (value.startsWith('wa') || value.startsWith('wpp') || value.includes('whatsapp')) {
    return 'whatsapp';
  }

  if (value.startsWith('yt') || value.includes('youtube')) return 'youtube';

  return 'outro_sck';
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
    const sckType = classifySck(sck);

    const utmSource = firstFilled(
      tracking.utm_source,
      tracking.source,
      tracking.source_sck,
      origin.utm_source,
      checkout.utm_source,
      findDeepValue(payload, ['utm_source', 'source']),
      findQueryParamAnywhere(payload, 'utm_source')
    );

    const utmMedium = firstFilled(
      tracking.utm_medium,
      tracking.medium,
      origin.utm_medium,
      checkout.utm_medium,
      findDeepValue(payload, ['utm_medium', 'medium']),
      findQueryParamAnywhere(payload, 'utm_medium')
    );

    const utmContent = firstFilled(
      tracking.utm_content,
      tracking.content,
      origin.utm_content,
      checkout.utm_content,
      findDeepValue(payload, ['utm_content', 'content']),
      findQueryParamAnywhere(payload, 'utm_content')
    );

    const rawUtmTerm = firstFilled(
      tracking.utm_term,
      tracking.term,
      origin.utm_term,
      checkout.utm_term,
      findDeepValue(payload, ['utm_term', 'term']),
      findQueryParamAnywhere(payload, 'utm_term')
    );

    const fbclid = firstFilled(
      tracking.fbclid,
      origin.fbclid,
      checkout.fbclid,
      findDeepValue(payload, ['fbclid']),
      findQueryParamAnywhere(payload, 'fbclid')
    );

    const gclid = firstFilled(
      tracking.gclid,
      origin.gclid,
      checkout.gclid,
      findDeepValue(payload, ['gclid']),
      findQueryParamAnywhere(payload, 'gclid')
    );

    // O VID pode chegar no src, utm_term, utm_content ou até no sck
    const rawSrc = firstFilled(
      origin.src,
      tracking.src,
      checkout.src,
      findDeepValue(payload, ['src']),
      findQueryParamAnywhere(payload, 'src')
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
      tracking.campaign,
      origin.utm_campaign,
      checkout.utm_campaign,
      findDeepValue(payload, ['utm_campaign', 'campaign']),
      findQueryParamAnywhere(payload, 'utm_campaign')
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

    const checkoutParams = {
      ...buildCheckoutParams({ tracking, origin, checkout }),
      extracted: {
        sck,
        sck_type: sckType,
        raw_src: rawSrc,
        vid,
        utm_term_clean: utmTerm
      }
    };

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
        ' | sck_type:' +
        sckType +
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
      sck_type: sckType,
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
    if (sckValue.includes('instagram')) return 'meta';
    if (sckValue.startsWith('fb')) return 'meta';
    if (sckValue.startsWith('meta')) return 'meta';
    if (sckValue.startsWith('an')) return 'meta';

    if (sckValue.startsWith('gg')) return 'google';
    if (sckValue.startsWith('google')) return 'google';

    if (sckValue.startsWith('yt')) return 'other';
    if (sckValue.includes('youtube')) return 'other';

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
