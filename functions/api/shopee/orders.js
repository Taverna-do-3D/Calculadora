import { getCredentials, buildSignedUrl, shopeeFetch, json, unixTimestamp } from './_utils.js';

export async function onRequestGet(context) {
  return handleOrders(context);
}

export async function onRequestPost(context) {
  return handleOrders(context);
}

export async function onRequestOptions() {
  return json({}, 200);
}

async function handleOrders(context) {
  const { request, env } = context;
  const url = new URL(request.url);
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

    // 1. Obter lista de números de pedidos
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

    // 2. Obter detalhes dos pedidos
    const pathDetail = '/api/v2/order/get_order_detail';
    const detailUrl = await buildSignedUrl(pathDetail, creds, { accessToken, shopId });
    detailUrl.searchParams.set('order_sn_list', orderSns.slice(0, 50).join(','));
    detailUrl.searchParams.set('response_optional_fields', 'buyer_username,item_list,total_amount,ship_by_date,create_time,order_status');

    const detailRes = await shopeeFetch(detailUrl, creds, { method: 'GET' });
    const detailData = await detailRes.json();

    const detailList = detailData.response?.order_list || [];

    // 3. Mapear para o formato do Kanban da Taverna do 3D
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
    console.error('Erro ao buscar pedidos na Shopee:', err);
    return json({
      success: false,
      error: 'internal_error',
      message: 'Erro interno ao processar pedidos: ' + err.message
    }, 500);
  }
}
