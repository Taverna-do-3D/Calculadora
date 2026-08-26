const DEFAULT_PARTNER_ID = 2042545;
const DEFAULT_PARTNER_KEY = 'shpk7452725641576e6843564b6e5a456951564b5a424373685a7a6673525244';
const SHOPEE_HOST = 'https://openplatform.shopee.com.br';
const SHOPEE_BACKUP_HOST = 'https://partner.shopeemobile.com';

export function getCredentials(env = {}) {
  const partnerId = parseInt(env.SHOPEE_PARTNER_ID || DEFAULT_PARTNER_ID, 10);
  const partnerKey = (env.SHOPEE_PARTNER_KEY || DEFAULT_PARTNER_KEY).trim();
  const proxyOrigin = (env.SHOPEE_PROXY_ORIGIN || '').trim();
  const proxySecret = (env.SHOPEE_PROXY_SECRET || '').trim();
  return { partnerId, partnerKey, proxyOrigin, proxySecret };
}

export function unixTimestamp() {
  return Math.floor(Date.now() / 1000);
}

export async function hmacSha256(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function buildSignedUrl(path, creds, { accessToken = '', shopId = '' } = {}) {
  const timestamp = unixTimestamp();
  const baseStr = `${creds.partnerId}${path}${timestamp}${accessToken || ''}${shopId || ''}`;
  const sign = await hmacSha256(creds.partnerKey, baseStr);
  
  const baseHost = creds.proxyOrigin || SHOPEE_HOST;
  const url = new URL(path, baseHost);
  url.searchParams.set('partner_id', creds.partnerId.toString());
  url.searchParams.set('timestamp', timestamp.toString());
  url.searchParams.set('sign', sign);
  if (accessToken) url.searchParams.set('access_token', accessToken);
  if (shopId) url.searchParams.set('shop_id', shopId.toString());
  return url;
}

export async function shopeeFetch(url, creds, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (creds.proxySecret) {
    headers.set('Authorization', `Bearer ${creds.proxySecret}`);
  }

  let response;
  try {
    response = await fetch(url.toString(), { ...options, headers });
  } catch (err) {
    // Se o host principal falhar, tenta o backup caso não esteja usando proxy
    if (!creds.proxyOrigin && url.origin === SHOPEE_HOST) {
      const backupUrl = new URL(url.pathname + url.search, SHOPEE_BACKUP_HOST);
      response = await fetch(backupUrl.toString(), { ...options, headers });
    } else {
      throw err;
    }
  }

  return response;
}

export function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers(extraHeaders);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Shopee-Access-Token, X-Shopee-Shop-Id');
  return new Response(JSON.stringify(data), { status, headers });
}
