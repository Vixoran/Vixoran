const META_API_VERSION = 'v19.0';

export async function sendToMetaCAPI(event) {
  const PIXEL_ID = process.env.META_PIXEL_ID;
  const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
  const TEST_CODE = process.env.META_TEST_CODE;

  if (!PIXEL_ID || !ACCESS_TOKEN) {
    console.warn('⚠️  META_PIXEL_ID ou META_ACCESS_TOKEN não configurados');
    return null;
  }

  const body = { data: [event], access_token: ACCESS_TOKEN };
  if (TEST_CODE) body.test_event_code = TEST_CODE;

  try {
    const res = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${PIXEL_ID}/events`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    const result = await res.json();
    if (!res.ok) console.error('Meta CAPI error:', JSON.stringify(result));
    return result;
  } catch (err) {
    console.error('Falha ao chamar Meta CAPI:', err.message);
    return null;
  }
}

export function buildMetaEvent({ eventName, eventId, userData, customData, sourceUrl, clientIp, clientUserAgent }) {
  const event = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: 'website',
    event_source_url: sourceUrl,
    user_data: {},
    custom_data: customData || {},
  };

  if (userData.em)  event.user_data.em  = userData.em;
  if (userData.ph)  event.user_data.ph  = userData.ph;
  if (userData.fbp) event.user_data.fbp = userData.fbp;
  if (userData.fbc) event.user_data.fbc = userData.fbc;
  if (clientIp)     event.user_data.client_ip_address = clientIp;
  if (clientUserAgent) event.user_data.client_user_agent = clientUserAgent;

  return event;
}

// SHA256 no servidor (para email/telefone vindos da Hotmart)
export async function sha256(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
