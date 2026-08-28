import baseWorker from './worker-manual-name-entry.js';

export default {
  async fetch(request, env, ctx) {
    const response = await baseWorker.fetch(request, env, ctx);
    const url = new URL(request.url);
    const contentType = response.headers.get('Content-Type') || '';

    let output = response;

    if (contentType.includes('text/html')) {
      output = new HTMLRewriter()
        .on('body', {
          element(element) {
            element.append('<script src="/auto-cache-refresh.js?v=2"></script>', { html: true });
            element.append('<script src="/settings-save-guard.js?v=1"></script>', { html: true });
          },
        })
        .transform(response);
    }

    // Evita que navegador/PWA segure versões antigas do código do aplicativo.
    if (
      contentType.includes('text/html') ||
      contentType.includes('javascript') ||
      contentType.includes('text/css') ||
      contentType.includes('application/json') ||
      url.pathname === '/service-worker.js'
    ) {
      const headers = new Headers(output.headers);
      headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      headers.set('Pragma', 'no-cache');
      headers.set('Expires', '0');
      return new Response(output.body, {
        status: output.status,
        statusText: output.statusText,
        headers,
      });
    }

    return output;
  },
};
