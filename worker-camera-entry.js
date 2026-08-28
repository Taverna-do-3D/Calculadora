import appWorker from './worker-entry.js';

const BAMBU_API = 'https://api.bambulab.com';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

function summarizeCameraPayload(payload) {
  const root = payload && typeof payload === 'object' ? payload : {};
  const data = root.data && typeof root.data === 'object' ? root.data : root;
  const keys = Object.keys(data);

  const hasUid = Boolean(data.uid || data.UID || data.device_uid || data.iotc_uid);
  const hasAuthKey = Boolean(data.authkey || data.auth_key || data.authKey || data.key);
  const hasPassword = Boolean(data.passwd || data.password || data.pwd);
  const hasRegion = Boolean(data.region || data.area || data.server_region);
  const hasTtcode = Boolean(data.ttcode || data.tt_code || data.code);

  return {
    fields: keys,
    has_uid: hasUid,
    has_auth_key: hasAuthKey,
    has_password: hasPassword,
    has_region: hasRegion,
    has_ttcode: hasTtcode,
    looks_usable: hasUid || hasTtcode || (hasAuthKey && hasPassword),
  };
}

async function testBambuCloudCamera(token, devId) {
  const response = await fetch(`${BAMBU_API}/v1/iot-service/api/user/ttcode`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'BambuStudio/01.09.03.50',
    },
    body: JSON.stringify({ dev_id: devId }),
  });

  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; }
  catch (_) { payload = { raw_type: 'non-json' }; }

  const summary = summarizeCameraPayload(payload);
  const apiMessage = payload?.message || payload?.msg || payload?.error || null;

  return {
    ok: response.ok,
    status: response.status,
    message: apiMessage,
    summary,
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/bambu/camera-cloud-test') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
      if (request.method !== 'POST') return jsonResponse({ success: false, error: 'Método não permitido.' }, 405);

      try {
        const body = await request.json().catch(() => ({}));
        const token = String(body.token || '').trim();
        const devId = String(body.dev_id || '').trim();
        if (!token || !devId) {
          return jsonResponse({ success: false, error: 'Token Bambu e ID da impressora são obrigatórios.' }, 400);
        }

        const result = await testBambuCloudCamera(token, devId);
        return jsonResponse({
          success: result.ok,
          cloud_camera_available: result.ok && result.summary.looks_usable,
          bambu_status: result.status,
          bambu_message: result.message,
          camera_fields: result.summary.fields,
          has_uid: result.summary.has_uid,
          has_auth_key: result.summary.has_auth_key,
          has_password: result.summary.has_password,
          has_region: result.summary.has_region,
          has_ttcode: result.summary.has_ttcode,
          note: result.ok
            ? 'A Bambu Cloud respondeu ao pedido de credenciais da câmera. Nenhuma credencial secreta foi enviada ao navegador.'
            : 'A Bambu Cloud recusou ou não processou o pedido de credenciais da câmera.',
        }, result.ok ? 200 : 502);
      } catch (err) {
        return jsonResponse({ success: false, error: err?.message || String(err) }, 500);
      }
    }

    const response = await appWorker.fetch(request, env, ctx);
    const contentType = response.headers.get('content-type') || '';
    if (request.method === 'GET' && contentType.includes('text/html')) {
      try {
        return new HTMLRewriter()
          .on('body', {
            element(element) {
              element.append('<script src="/bambu-camera-cloud-patch.js?v=1"></script>', { html: true });
            }
          })
          .transform(response);
      } catch (_) {
        return response;
      }
    }
    return response;
  }
};
