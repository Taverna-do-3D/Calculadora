import { getCredentials, buildSignedUrl, json } from './_utils.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const creds = getCredentials(env);

  const redirectUrl = `${url.origin}/api/shopee/callback`;
  const path = '/api/v2/shop/auth_partner';

  const authUrl = await buildSignedUrl(path, creds);
  authUrl.searchParams.set('redirect', redirectUrl);

  const format = url.searchParams.get('format');
  if (format === 'json') {
    return json({ authUrl: authUrl.toString(), redirectUrl });
  }

  return Response.redirect(authUrl.toString(), 302);
}

export async function onRequestOptions() {
  return json({}, 200);
}
