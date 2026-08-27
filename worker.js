/**
 * ===================================================================
 *  TAVERNA DO 3D - CALCULADORA 3D WORKER
 *  Servidor Cloudflare Worker para entrega estática do aplicativo
 * ===================================================================
 */

export default {
  async fetch(request, env, ctx) {
    // Tratar CORS Preflight se necessário
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    // Servir arquivos estáticos do frontend (Cloudflare Assets)
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }

    return new Response('Calculadora Taverna do 3D Online.', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
};
