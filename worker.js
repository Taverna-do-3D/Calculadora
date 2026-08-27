/**
 * ===================================================================
 *  TAVERNA DO 3D - SHOPEE OPEN PLATFORM API v2 WORKER
 *  Cloudflare Worker para Autenticação, Sync de Pedidos e Proxy
 * ===================================================================
 */

const SHOPEE_HOST = 'https://openplatform.shopee.com.br';
const DEFAULT_PARTNER_ID = 2042983;
const DEFAULT_PARTNER_KEY = 'shpk79597677764c5643766e655763466b66436d5152684c516f6d4378666b59';
const DEFAULT_SHOP_ID = '1767798393';

/**
 * Resposta JSON padronizada com cabeçalhos CORS
 */
function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Shopee-Access-Token, X-Shopee-Shop-Id, X-Shopee-Partner-Id',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      ...extraHeaders
    }
  });
}

/**
 * Extrai credenciais combinando Variáveis de Ambiente do Worker e Headers/Query
 */
function getCredentials(env = {}, request = null, url = null) {
  const partnerId = parseInt(
    (request && request.headers.get('X-Shopee-Partner-Id')) ||
    (url && url.searchParams.get('partner_id')) ||
    env.SHOPEE_PARTNER_ID ||
    DEFAULT_PARTNER_ID,
    10
  );

  const partnerKey = (
    (request && request.headers.get('X-Shopee-Partner-Key')) ||
    env.SHOPEE_PARTNER_KEY ||
    DEFAULT_PARTNER_KEY
  ).trim();

  const shopId = (
    (request && request.headers.get('X-Shopee-Shop-Id')) ||
    (url && url.searchParams.get('shop_id')) ||
    env.SHOPEE_SHOP_ID ||
    DEFAULT_SHOP_ID
  ).toString().trim();

  const accessToken = (
    (request && request.headers.get('X-Shopee-Access-Token')) ||
    (url && url.searchParams.get('access_token')) ||
    env.SHOPEE_ACCESS_TOKEN ||
    partnerKey
  ).trim();

  const redirectUrl = (
    env.SHOPEE_REDIRECT_URL ||
    (url ? `${url.origin}/` : 'https://calculadora.tavernado3d.workers.dev/')
  ).trim();

  return { partnerId, partnerKey, shopId, accessToken, redirectUrl };
}

/**
 * Gera Timestamp Unix atual em segundos
 */
function unixTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Assinatura Criptográfica HMAC-SHA256 oficial da Shopee Open API v2
 */
async function generateHmacSha256(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    enc.encode(message)
  );
  return Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Constrói uma URL assinada pronta para requisições na API Shopee
 */
async function buildSignedUrl(path, creds, { accessToken = '', shopId = '' } = {}) {
  const timestamp = unixTimestamp();
  const baseString = `${creds.partnerId}${path}${timestamp}${accessToken || ''}${shopId || ''}`;
  const sign = await generateHmacSha256(creds.partnerKey, baseString);

  const url = new URL(path, SHOPEE_HOST);
  url.searchParams.set('partner_id', creds.partnerId.toString());
  url.searchParams.set('timestamp', timestamp.toString());
  url.searchParams.set('sign', sign);
  if (accessToken) url.searchParams.set('access_token', accessToken);
  if (shopId) url.searchParams.set('shop_id', shopId.toString());

  return url;
}

/**
 * Realiza fetch seguro com a Shopee
 */
async function shopeeRequest(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  return fetch(url.toString(), {
    ...options,
    headers
  });
}

/**
 * Mapeia os status da Shopee para os status internos do Kanban da Calculadora
 */
function mapShopeeStatus(shopeeStatus) {
  switch (shopeeStatus) {
    case 'UNPAID':
      return 'pending';
    case 'READY_TO_SHIP':
    case 'PROCESSED':
      return 'print'; // Pronto para produção / impressão 3D
    case 'SHIPPED':
    case 'TO_CONFIRM_RECEIVE':
      return 'shipped';
    case 'COMPLETED':
      return 'done';
    case 'CANCELLED':
    case 'IN_CANCEL':
      return 'cancelled';
    default:
      return 'pending';
  }
}

/**
 * Renderiza página amigável de retorno da autorização OAuth
 */
function renderOAuthCallbackPage(success, message, payload = {}) {
  const payloadJson = JSON.stringify(payload);
  const isOk = Boolean(success);

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Autorização Shopee - Taverna do 3D</title>
  <style>
    body {
      background: #0f172a;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
      box-sizing: border-box;
    }
    .card {
      background: #1e293b;
      border: 1px solid ${isOk ? '#10b981' : '#ef4444'};
      border-radius: 16px;
      padding: 32px 24px;
      max-width: 480px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0,0,0,0.5);
    }
    h2 { margin: 0 0 12px; color: ${isOk ? '#10b981' : '#ef4444'}; font-size: 22px; }
    p { color: #94a3b8; font-size: 14px; line-height: 1.5; margin-bottom: 24px; }
    .btn {
      display: inline-block;
      background: #f97316;
      color: #fff;
      font-weight: 700;
      padding: 12px 24px;
      border-radius: 10px;
      text-decoration: none;
      border: none;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="card">
    <h2>${isOk ? '✅ Conexão Realizada!' : '⚠️ Erro na Conexão'}</h2>
    <p>${message}</p>
    <button class="btn" onclick="window.close();">Fechar Janela</button>
  </div>
  <script>
    try {
      const data = ${payloadJson};
      if (window.opener) {
        window.opener.postMessage({
          type: '${isOk ? 'pedidos:shopee-auth-success' : 'pedidos:shopee-error'}',
          message: '${message}',
          ...data
        }, '*');
      }
    } catch(e){}
    setTimeout(() => {
      if (window.opener) window.close();
      else window.location.href = '/';
    }, 2500);
  </script>
</body>
</html>`;

  return new Response(html, {
    status: isOk ? 200 : 400,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

/**
 * Handler Principal do Cloudflare Worker
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Tratar CORS Preflight
    if (request.method === 'OPTIONS') {
      return jsonResponse({}, 200);
    }

    const creds = getCredentials(env, request, url);

    // ========================================================
    // 1. TESTE / PING DE CONEXÃO COM A SHOPEE
    // ========================================================
    if (url.pathname === '/api/shopee/ping') {
      try {
        const pathShop = '/api/v2/shop/get_shop_info';
        const shopUrl = await buildSignedUrl(pathShop, creds, {
          accessToken: creds.accessToken,
          shopId: creds.shopId
        });

        const res = await shopeeRequest(shopUrl, { method: 'GET' });
        const data = await res.json();

        if (res.ok && !data.error) {
          const shopName = data.response?.shop_name || `Loja #${creds.shopId}`;
          return jsonResponse({
            success: true,
            status: 'connected',
            shopId: creds.shopId,
            shopName: shopName,
            partnerId: creds.partnerId,
            message: `Conexão ativa com a loja "${shopName}"!`
          });
        } else {
          return jsonResponse({
            success: false,
            status: 'error',
            error: data.error || 'api_error',
            message: data.message || 'Erro ao validar conexão com a Shopee.',
            partnerId: creds.partnerId,
            shopId: creds.shopId
          }, res.status || 400);
        }
      } catch (err) {
        return jsonResponse({
          success: false,
          status: 'network_error',
          error: err.message
        }, 500);
      }
    }

    // ========================================================
    // 2. INICIAR LOGIN OAUTH (REDIRECIONAMENTO)
    // ========================================================
    if (url.pathname === '/api/shopee/auth') {
      const timestamp = unixTimestamp();
      const pathAuth = '/api/v2/shop/auth_partner';
      const baseString = `${creds.partnerId}${pathAuth}${timestamp}`;
      const sign = await generateHmacSha256(creds.partnerKey, baseString);

      const redirectTarget = url.searchParams.get('redirect') || creds.redirectUrl;

      const authUrl = new URL(pathAuth, SHOPEE_HOST);
      authUrl.searchParams.set('partner_id', creds.partnerId.toString());
      authUrl.searchParams.set('timestamp', timestamp.toString());
      authUrl.searchParams.set('sign', sign);
      authUrl.searchParams.set('redirect', redirectTarget);

      return Response.redirect(authUrl.toString(), 302);
    }

    // ========================================================
    // 3. CALLBACK DE AUTORIZAÇÃO OAUTH
    // ========================================================
    if (url.pathname === '/api/shopee/callback') {
      const code = url.searchParams.get('code');
      const shopId = url.searchParams.get('shop_id') || creds.shopId;
      const error = url.searchParams.get('error');
      const errorMsg = url.searchParams.get('message');

      if (error || !code) {
        return renderOAuthCallbackPage(false, errorMsg || 'Autorização não concluída na Shopee.');
      }

      try {
        const pathToken = '/api/v2/auth/token/get';
        const tokenUrl = await buildSignedUrl(pathToken, creds);
        const tokenRes = await shopeeRequest(tokenUrl, {
          method: 'POST',
          body: JSON.stringify({
            code,
            partner_id: creds.partnerId,
            shop_id: shopId ? parseInt(shopId, 10) : undefined
          })
        });

        const tokenData = await tokenRes.json();

        if (!tokenRes.ok || tokenData.error) {
          return renderOAuthCallbackPage(true, 'Autorizado! Finalizando conexão no aplicativo...', {
            code,
            shopId
          });
        }

        const accessToken = tokenData.access_token;
        const refreshToken = tokenData.refresh_token || '';
        const finalShopId = (tokenData.shop_id || shopId).toString();

        return renderOAuthCallbackPage(true, 'Loja conectada com sucesso!', {
          accessToken,
          refreshToken,
          shopId: finalShopId,
          expireIn: tokenData.expire_in || 14400
        });
      } catch (err) {
        return renderOAuthCallbackPage(false, 'Erro ao processar tokens: ' + err.message);
      }
    }

    // ========================================================
    // 4. TROCA OU RENOVAÇÃO DE TOKEN (POST /api/shopee/token)
    // ========================================================
    if (url.pathname === '/api/shopee/token' && request.method === 'POST') {
      try {
        const body = await request.json();
        const code = body.code;
        const refreshToken = body.refresh_token || body.refreshToken;
        const shopId = body.shop_id || body.shopId || creds.shopId;

        if (code) {
          const pathToken = '/api/v2/auth/token/get';
          const tokenUrl = await buildSignedUrl(pathToken, creds);
          const res = await shopeeRequest(tokenUrl, {
            method: 'POST',
            body: JSON.stringify({
              code,
              partner_id: creds.partnerId,
              shop_id: shopId ? parseInt(shopId, 10) : undefined
            })
          });
          const data = await res.json();
          return jsonResponse(data, res.status);
        } else if (refreshToken) {
          const pathRefresh = '/api/v2/auth/access_token/get';
          const refreshUrl = await buildSignedUrl(pathRefresh, creds);
          const res = await shopeeRequest(refreshUrl, {
            method: 'POST',
            body: JSON.stringify({
              refresh_token: refreshToken,
              partner_id: creds.partnerId,
              shop_id: shopId ? parseInt(shopId, 10) : undefined
            })
          });
          const data = await res.json();
          return jsonResponse(data, res.status);
        } else {
          return jsonResponse({ error: 'missing_code_or_refresh_token' }, 400);
        }
      } catch (err) {
        return jsonResponse({ error: 'internal_error', message: err.message }, 500);
      }
    }

    // ========================================================
    // 5. BUSCA DE PEDIDOS EM TEMPO REAL (/api/shopee/orders)
    // ========================================================
    if (url.pathname === '/api/shopee/orders') {
      try {
        const now = unixTimestamp();
        const fifteenDaysAgo = now - (15 * 86400);
        const orderStatus = url.searchParams.get('order_status') || 'READY_TO_SHIP';

        // 1. Obter lista de pedidos
        const pathList = '/api/v2/order/get_order_list';
        const listUrl = await buildSignedUrl(pathList, creds, {
          accessToken: creds.accessToken,
          shopId: creds.shopId
        });

        listUrl.searchParams.set('time_range_field', 'create_time');
        listUrl.searchParams.set('time_from', fifteenDaysAgo.toString());
        listUrl.searchParams.set('time_to', now.toString());
        listUrl.searchParams.set('page_size', '50');
        listUrl.searchParams.set('response_optional_fields', 'order_status');
        if (orderStatus && orderStatus !== 'ALL') {
          listUrl.searchParams.set('order_status', orderStatus);
        }

        const listRes = await shopeeRequest(listUrl, { method: 'GET' });
        const listData = await listRes.json();

        if (!listRes.ok || listData.error) {
          return jsonResponse({
            success: false,
            error: listData.error || 'api_error',
            message: listData.message || 'Erro ao consultar lista de pedidos na Shopee.',
            request_id: listData.request_id
          }, listRes.status || 400);
        }

        const rawList = listData.response?.order_list || [];
        const orderSns = rawList.map(o => o.order_sn).filter(Boolean);

        if (orderSns.length === 0) {
          return jsonResponse({
            success: true,
            count: 0,
            orders: [],
            message: 'Nenhum pedido pendente encontrado na Shopee no momento.'
          });
        }

        // 2. Obter detalhes completos dos pedidos
        const pathDetail = '/api/v2/order/get_order_detail';
        const detailUrl = await buildSignedUrl(pathDetail, creds, {
          accessToken: creds.accessToken,
          shopId: creds.shopId
        });
        detailUrl.searchParams.set('order_sn_list', orderSns.slice(0, 50).join(','));
        detailUrl.searchParams.set('response_optional_fields', 'buyer_username,item_list,total_amount,ship_by_date,create_time,order_status');

        const detailRes = await shopeeRequest(detailUrl, { method: 'GET' });
        const detailData = await detailRes.json();

        const rawDetails = detailData.response?.order_list || [];

        // 3. Formatar pedidos para o padrão limpo do Kanban da Calculadora
        const formattedOrders = rawDetails.map(order => {
          const itemsSummary = (order.item_list || [])
            .map(item => `${item.item_name || 'Item 3D'} (${item.model_quantity_purchased || 1}x)`)
            .join(' + ') || 'Produto 3D Shopee';

          const totalValue = parseFloat(order.total_amount) || 0;
          const createdAt = order.create_time ? new Date(order.create_time * 1000).toISOString() : new Date().toISOString();

          return {
            id: `SHP-${order.order_sn.slice(-6)}`,
            shopeeId: order.order_sn,
            customer: order.buyer_username || `Cliente Shopee (#${order.order_sn.slice(-4)})`,
            clientName: order.buyer_username || `Cliente Shopee (#${order.order_sn.slice(-4)})`,
            product: itemsSummary,
            itemsSummary: itemsSummary,
            totalPrice: totalValue,
            value: totalValue,
            channel: 'shopee',
            channelName: 'Shopee',
            status: mapShopeeStatus(order.order_status),
            rawStatus: order.order_status,
            createdAt: createdAt,
            date: createdAt,
            shipByDate: order.ship_by_date ? new Date(order.ship_by_date * 1000).toLocaleDateString('pt-BR') : '',
            items: (order.item_list || []).map(item => ({
              name: item.item_name || 'Peça 3D',
              qty: item.model_quantity_purchased || 1,
              price: item.model_discounted_price || item.model_original_price || 0,
              variation: item.model_name || ''
            }))
          };
        });

        return jsonResponse({
          success: true,
          count: formattedOrders.length,
          orders: formattedOrders,
          message: `${formattedOrders.length} pedido(s) sincronizado(s) com sucesso!`
        });
      } catch (err) {
        return jsonResponse({
          success: false,
          error: 'orders_sync_error',
          message: err.message
        }, 500);
      }
    }

    // ========================================================
    // 6. SERVIR ARQUIVOS ESTÁTICOS DO FRONTEND
    // ========================================================
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }

    return new Response('Calculadora Worker Ativo.', { status: 200 });
  }
};
