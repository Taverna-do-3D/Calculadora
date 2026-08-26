const DEFAULT_PARTNER_ID = 2042545;
const DEFAULT_PARTNER_KEY = 'shpk7452725641576e6843564b6e5a456951564b5a424373685a7a6673525244';
const SHOPEE_HOST = 'https://openplatform.shopee.com.br';
const SHOPEE_BACKUP_HOST = 'https://partner.shopeemobile.com';

function getCredentials(env = {}) {
  const partnerId = parseInt(env.SHOPEE_PARTNER_ID || DEFAULT_PARTNER_ID, 10);
  const partnerKey = (env.SHOPEE_PARTNER_KEY || DEFAULT_PARTNER_KEY).trim();
  const proxyOrigin = (env.SHOPEE_PROXY_ORIGIN || '').trim();
  const proxySecret = (env.SHOPEE_PROXY_SECRET || '').trim();
  return { partnerId, partnerKey, proxyOrigin, proxySecret };
}

function unixTimestamp() {
  return Math.floor(Date.now() / 1000);
}

async function hmacSha256(key, message) {
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

async function buildSignedUrl(path, creds, { accessToken = '', shopId = '' } = {}) {
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

async function shopeeFetch(url, creds, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (creds.proxySecret) {
    headers.set('Authorization', `Bearer ${creds.proxySecret}`);
  }

  let response;
  try {
    response = await fetch(url.toString(), { ...options, headers });
  } catch (err) {
    if (!creds.proxyOrigin && url.origin === SHOPEE_HOST) {
      const backupUrl = new URL(url.pathname + url.search, SHOPEE_BACKUP_HOST);
      response = await fetch(backupUrl.toString(), { ...options, headers });
    } else {
      throw err;
    }
  }
  return response;
}

function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers(extraHeaders);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Shopee-Access-Token, X-Shopee-Shop-Id');
  return new Response(JSON.stringify(data), { status, headers });
}

function renderCallbackPage(success, message, extraData = {}) {
  const payload = JSON.stringify({
    type: success ? 'pedidos:shopee-connected' : 'pedidos:shopee-error',
    message,
    ...extraData
  }).replace(/</g, '\\u003c');

  const title = success ? 'Shopee Conectada!' : 'Falha na Conexão';
  const icon = success ? '✓' : '!';
  const color = success ? '#ee4d2d' : '#ef4444';

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · Taverna do 3D</title>
  <style>
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      background: #120f0d; color: #f7eee4; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    }
    .card {
      max-width: 440px; margin: 20px; padding: 32px 24px; text-align: center;
      background: #1e1915; border: 1px solid rgba(245, 158, 11, 0.25);
      border-radius: 18px; box-shadow: 0 20px 60px rgba(0,0,0,0.7);
    }
    .icon {
      width: 58px; height: 58px; margin: 0 auto 16px; border-radius: 16px;
      background: ${color}; color: #fff; display: grid; place-items: center;
      font-size: 32px; font-weight: 900;
    }
    h1 { font-size: 22px; margin: 0 0 10px; color: #f59e0b; }
    p { color: #a89a8a; line-height: 1.5; font-size: 14px; margin: 0 0 16px; }
    .btn {
      display: inline-block; padding: 10px 20px; background: #f59e0b; color: #120f0d;
      font-weight: 700; text-decoration: none; border-radius: 8px; font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="/" class="btn" id="btnBack">Voltar ao Aplicativo</a>
  </div>
  <script>
    const payload = ${payload};
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(payload, '*');
      if (payload.type === 'pedidos:shopee-connected') {
        setTimeout(() => window.close(), 1200);
      }
    } else {
      if (payload.type === 'pedidos:shopee-connected') {
        setTimeout(() => location.replace('/?shopee=connected'), 1200);
      }
    }
  </script>
</body>
</html>`;

  return new Response(html, {
    status: success ? 200 : 400,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return json({}, 200);
    }

    // 1. INICIAR LOGIN SHOPEE (OAUTH)
    if (url.pathname === '/api/shopee/auth') {
      const creds = getCredentials(env);
      const redirectUrl = `${url.origin}/api/shopee/callback`;
      const path = '/api/v2/shop/auth_partner';

      const authUrl = await buildSignedUrl(path, creds);
      authUrl.searchParams.set('redirect', redirectUrl);

      if (url.searchParams.get('format') === 'json') {
        return json({ authUrl: authUrl.toString(), redirectUrl });
      }
      return Response.redirect(authUrl.toString(), 302);
    }

    // 2. CALLBACK DA SHOPEE
    if (url.pathname === '/api/shopee/callback') {
      const creds = getCredentials(env);
      const code = url.searchParams.get('code') || '';
      const shopId = url.searchParams.get('shop_id') || '';
      const errorParam = url.searchParams.get('error') || '';
      const errorMsgParam = url.searchParams.get('message') || '';

      if (errorParam || !code) {
        return renderCallbackPage(false, errorMsgParam || 'A autorização foi cancelada ou recusada na Shopee.');
      }

      try {
        const pathToken = '/api/v2/auth/token/get';
        const tokenUrl = await buildSignedUrl(pathToken, creds);
        const tokenRes = await shopeeFetch(tokenUrl, creds, {
          method: 'POST',
          body: JSON.stringify({
            code,
            partner_id: creds.partnerId,
            shop_id: shopId ? parseInt(shopId, 10) : undefined
          })
        });

        const tokenData = await tokenRes.json();

        if (!tokenRes.ok || tokenData.error) {
          const errDetail = tokenData.message || tokenData.error || 'Falha ao trocar código de acesso com a Shopee.';
          return renderCallbackPage(true, 'Autorização concluída! Validando credenciais...', {
            code,
            shopId,
            warning: errDetail
          });
        }

        const accessToken = tokenData.access_token;
        const refreshToken = tokenData.refresh_token;
        const expiresIn = tokenData.expire_in || 14400;
        const finalShopId = (tokenData.shop_id || shopId || '').toString();

        let shopName = `Loja Shopee #${finalShopId}`;
        try {
          const pathShop = '/api/v2/shop/get_shop_info';
          const shopUrl = await buildSignedUrl(pathShop, creds, { accessToken, shopId: finalShopId });
          const shopRes = await shopeeFetch(shopUrl, creds, { method: 'GET' });
          if (shopRes.ok) {
            const shopData = await shopRes.json();
            if (shopData.response?.shop_name) {
              shopName = shopData.response.shop_name;
            }
          }
        } catch (e) {
          console.warn('Erro ao obter nome da loja:', e);
        }

        return renderCallbackPage(true, `Loja "${shopName}" conectada com sucesso!`, {
          accessToken,
          refreshToken,
          expiresIn,
          shopId: finalShopId,
          shopName
        });
      } catch (err) {
        console.error('Erro no callback da Shopee:', err);
        return renderCallbackPage(false, 'Erro interno ao processar autorização: ' + err.message);
      }
    }

    // 3. BUSCAR PEDIDOS REAIS
    if (url.pathname === '/api/shopee/orders') {
      const creds = getCredentials(env);
      let accessToken = request.headers.get('X-Shopee-Access-Token') || url.searchParams.get('access_token');
      let shopId = request.headers.get('X-Shopee-Shop-Id') || url.searchParams.get('shop_id');
      const orderStatus = url.searchParams.get('order_status') || 'READY_TO_SHIP';

      if (!accessToken || !shopId) {
        if (request.method === 'POST') {
          try {
            const body = await request.json();
            accessToken = accessToken || body.access_token || body.accessToken;
            shopId = shopId || body.shop_id || body.shopId;
          } catch (e) {}
        }
      }

      if (!accessToken || !shopId) {
        return json({
          success: false,
          error: 'missing_credentials',
          message: 'Access Token e Shop ID da Shopee são obrigatórios.'
        }, 400);
      }

      try {
        const now = unixTimestamp();
        const fifteenDaysAgo = now - (15 * 86400);

        const pathList = '/api/v2/order/get_order_list';
        const listUrl = await buildSignedUrl(pathList, creds, { accessToken, shopId });
        listUrl.searchParams.set('time_range_field', 'create_time');
        listUrl.searchParams.set('time_from', fifteenDaysAgo.toString());
        listUrl.searchParams.set('time_to', now.toString());
        listUrl.searchParams.set('page_size', '50');
        listUrl.searchParams.set('response_optional_fields', 'order_status');
        if (orderStatus && orderStatus !== 'ALL') {
          listUrl.searchParams.set('order_status', orderStatus);
        }

        const listRes = await shopeeFetch(listUrl, creds, { method: 'GET' });
        const listData = await listRes.json();

        if (!listRes.ok || listData.error) {
          return json({
            success: false,
            error: listData.error || 'api_error',
            message: listData.message || 'Erro ao consultar lista de pedidos na Shopee.',
            request_id: listData.request_id
          }, listRes.status || 400);
        }

        const rawList = listData.response?.order_list || [];
        const orderSns = rawList.map(item => item.order_sn).filter(Boolean);

        if (orderSns.length === 0) {
          return json({
            success: true,
            count: 0,
            orders: [],
            message: 'Nenhum pedido pendente encontrado na sua loja Shopee.'
          });
        }

        const pathDetail = '/api/v2/order/get_order_detail';
        const detailUrl = await buildSignedUrl(pathDetail, creds, { accessToken, shopId });
        detailUrl.searchParams.set('order_sn_list', orderSns.slice(0, 50).join(','));
        detailUrl.searchParams.set('response_optional_fields', 'buyer_username,item_list,total_amount,ship_by_date,create_time,order_status');

        const detailRes = await shopeeFetch(detailUrl, creds, { method: 'GET' });
        const detailData = await detailRes.json();
        const detailList = detailData.response?.order_list || [];

        const mappedOrders = detailList.map(item => {
          const orderSn = item.order_sn;
          const firstItem = item.item_list?.[0] || {};
          const prodName = firstItem.item_name || 'Peça Personalizada 3D';
          const variation = firstItem.model_name || '';
          const buyer = item.buyer_username || 'Cliente Shopee';
          const price = parseFloat(item.total_amount) || 0;
          const shipBy = item.ship_by_date
            ? new Date(item.ship_by_date * 1000).toLocaleDateString('pt-BR')
            : 'Shopee Envio';
          const createdAt = item.create_time
            ? new Date(item.create_time * 1000).toISOString()
            : new Date().toISOString();

          let internalStatus = 'a_produzir';
          if (item.order_status === 'PROCESSED') internalStatus = 'em_producao';
          else if (item.order_status === 'SHIPPED' || item.order_status === 'COMPLETED') internalStatus = 'concluido';

          return {
            id: 'TAV-' + (orderSn.length > 4 ? orderSn.slice(-4) : Math.floor(1000 + Math.random() * 9000)),
            shopeeId: orderSn,
            client: buyer,
            product: variation ? `${prodName} (${variation})` : prodName,
            channel: 'shopee',
            status: internalStatus,
            price: price,
            deadline: shipBy,
            notes: variation ? `Variação: ${variation}` : 'Pedido Shopee Integrado',
            createdAt: createdAt
          };
        });

        return json({
          success: true,
          count: mappedOrders.length,
          orders: mappedOrders
        });
      } catch (err) {
        return json({ success: false, error: 'internal_error', message: err.message }, 500);
      }
    }

    // 4. TROCA OU RENOVAÇÃO DE TOKEN
    if (url.pathname === '/api/shopee/token') {
      const creds = getCredentials(env);
      let body = {};
      try { body = await request.json(); } catch (e) {}
      const { code, refresh_token: refreshToken, shop_id: shopId } = body;

      try {
        if (code) {
          const path = '/api/v2/auth/token/get';
          const tUrl = await buildSignedUrl(path, creds);
          const res = await shopeeFetch(tUrl, creds, {
            method: 'POST',
            body: JSON.stringify({ code, partner_id: creds.partnerId, shop_id: shopId ? parseInt(shopId, 10) : undefined })
          });
          return json(await res.json(), res.status);
        } else if (refreshToken) {
          const path = '/api/v2/auth/access_token/get';
          const tUrl = await buildSignedUrl(path, creds);
          const res = await shopeeFetch(tUrl, creds, {
            method: 'POST',
            body: JSON.stringify({ refresh_token: refreshToken, partner_id: creds.partnerId, shop_id: shopId ? parseInt(shopId, 10) : undefined })
          });
          return json(await res.json(), res.status);
        }
      } catch (err) {
        return json({ error: 'internal_error', message: err.message }, 500);
      }
    }

    // 5. Servir arquivos estáticos do frontend (Cloudflare Pages)
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  }
};
