/* Taverna do 3D — atualização automática de versão sem Ctrl+F5 */
(() => {
  if (!('serviceWorker' in navigator)) return;

  let updating = false;
  let reloading = false;

  async function ensureLatestVersion() {
    if (updating) return;
    updating = true;

    try {
      let registration = await navigator.serviceWorker.getRegistration();

      if (!registration) {
        registration = await navigator.serviceWorker.register('/service-worker.js', {
          updateViaCache: 'none'
        });
      }

      if (registration) {
        await registration.update();

        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      }
    } catch (error) {
      console.warn('[Taverna] Não foi possível verificar atualização do app.', error);
    } finally {
      updating = false;
    }
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    ensureLatestVersion();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ensureLatestVersion();
  });

  window.addEventListener('online', ensureLatestVersion);

  // Mantém o PWA verificando uma nova versão periodicamente enquanto estiver aberto.
  setInterval(ensureLatestVersion, 5 * 60 * 1000);
})();
