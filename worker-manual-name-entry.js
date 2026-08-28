import baseWorker from './worker-entry.js';

export default {
  async fetch(request, env, ctx) {
    const response = await baseWorker.fetch(request, env, ctx);
    const contentType = response.headers.get('Content-Type') || '';

    if (contentType.includes('text/html')) {
      return new HTMLRewriter()
        .on('body', {
          element(element) {
            element.append('<script src="/bambu-manual-name-override.js?v=1"></script>', { html: true });
          },
        })
        .transform(response);
    }

    return response;
  },
};
