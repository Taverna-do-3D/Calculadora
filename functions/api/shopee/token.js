import { getCredentials, buildSignedUrl, shopeeFetch, json } from './_utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const creds = getCredentials(env);

  let body = {};
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'invalid_json', message: 'Corpo JSON inválido.' }, 400);
  }

  const { code, refresh_token: refreshToken, shop_id: shopId } = body;

  try {
    if (code) {
      // Obter novo token por código de autorização
      const path = '/api/v2/auth/token/get';
      const url = await buildSignedUrl(path, creds);
      const res = await shopeeFetch(url, creds, {
        method: 'POST',
        body: JSON.stringify({
          code,
          partner_id: creds.partnerId,
          shop_id: shopId ? parseInt(shopId, 10) : undefined
        })
      });
      const data = await res.json();
      return json(data, res.status);
    } else if (refreshToken) {
      // Renovar access token
      const path = '/api/v2/auth/access_token/get';
      const url = await buildSignedUrl(path, creds);
      const res = await shopeeFetch(url, creds, {
        method: 'POST',
        body: JSON.stringify({
          refresh_token: refreshToken,
          partner_id: creds.partnerId,
          shop_id: shopId ? parseInt(shopId, 10) : undefined
        })
      });
      const data = await res.json();
      return json(data, res.status);
    } else {
      return json({ error: 'missing_params', message: 'Informe "code" ou "refresh_token".' }, 400);
    }
  } catch (err) {
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}

export async function onRequestOptions() {
  return json({}, 200);
}
