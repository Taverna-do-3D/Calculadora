import { getCredentials, buildSignedUrl, shopeeFetch } from './_utils.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const creds = getCredentials(env);

  const code = url.searchParams.get('code') || '';
  const shopId = url.searchParams.get('shop_id') || '';
  const errorParam = url.searchParams.get('error') || '';
  const errorMsgParam = url.searchParams.get('message') || '';

  if (errorParam || !code) {
    return renderCallbackPage(false, errorMsgParam || 'A autorização foi cancelada ou recusada na Shopee.');
  }

  try {
    // 1. Troca o código por access_token e refresh_token
    const pathToken = '/api/v2/auth/token/get';
    const tokenUrl = await buildSignedUrl(pathToken, creds);
    
    const bodyPayload = {
      code,
      partner_id: creds.partnerId,
      shop_id: shopId ? parseInt(shopId, 10) : undefined
    };

    const tokenRes = await shopeeFetch(tokenUrl, creds, {
      method: 'POST',
      body: JSON.stringify(bodyPayload)
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || tokenData.error) {
      const errDetail = tokenData.message || tokenData.error || 'Falha ao trocar código de acesso com a Shopee.';
      // Se der erro de IP ou proxy, repassa o código e shopId para o frontend tratar
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

    // 2. Busca o nome da loja
    let shopName = `Loja Shopee #${finalShopId}`;
    try {
      const pathShop = '/api/v2/shop/get_shop_info';
      const shopUrl = await buildSignedUrl(pathShop, creds, { accessToken, shopId: finalShopId });
      const shopRes = await shopeeFetch(shopUrl, creds, { method: 'GET' });
      if (shopRes.ok) {
        const shopData = await shopRes.json();
        if (shopData.response && shopData.response.shop_name) {
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
    return renderCallbackPage(false, 'Erro interno ao processar autorização da Shopee: ' + err.message);
  }
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
