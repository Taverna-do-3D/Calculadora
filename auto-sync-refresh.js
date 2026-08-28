/* Taverna do 3D — reforço de atualização automática entre aparelhos */
(() => {
  const AUTO_REFRESH_MS = 3000;
  let timer = null;
  let inFlight = false;

  async function refreshFromCloud() {
    if (inFlight || document.visibilityState !== 'visible' || !navigator.onLine) return;
    const sync = window.__tavernaCloudSync;
    if (!sync?.pull) return;
    inFlight = true;
    try {
      await sync.pull({ silent: true });
    } catch (_) {
      // A rotina principal já controla status/erros de rede.
    } finally {
      inFlight = false;
    }
  }

  function start() {
    clearInterval(timer);
    refreshFromCloud();
    timer = setInterval(refreshFromCloud, AUTO_REFRESH_MS);
  }

  window.addEventListener('focus', refreshFromCloud);
  window.addEventListener('online', refreshFromCloud);
  window.addEventListener('pageshow', refreshFromCloud);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshFromCloud();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
