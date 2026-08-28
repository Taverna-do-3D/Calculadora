import baseWorker from './worker-entry.js';

export default {
  async fetch(request, env, ctx) {
    const response = await baseWorker.fetch(request, env, ctx);
    const contentType = response.headers.get('Content-Type') || '';

    if (!contentType.includes('text/html')) return response;

    return new HTMLRewriter()
      .on('body', {
        element(element) {
          element.append('<script src="/calculator-config-patch.js?v=1"></script>', { html: true });
        }
      })
      .transform(response);
  }
};
