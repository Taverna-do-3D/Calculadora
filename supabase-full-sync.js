/* Taverna do 3D — sincronização completa PC <-> celular via Supabase */
(() => {
  const QUOTE_KEY = 'taverna3d:quotes';
  const WORKSPACE_KEY = 'taverna3d:workspace';
  const META_KEY = 'taverna3d:cloud-meta';
  const SYNC_DELAY_MS = 1200;
  const POLL_MS = 7000;

  const quoteIds = ['quoteClientName','quoteClientPhone','quoteDeadline','quoteShipping','quoteNotes'];
  const calcIds = ['calcItemName','calcHours','calcMins','calcGrams','calcMargin','calcExtraCosts','calcQty','calcFilamentSelect'];

  let suppressLocalEvents = false;
  let pushTimer = null;
  let pollTimer = null;
  let lastLocalChangeAt = 0;
  let lastRemoteAt = Number(JSON.parse(localStorage.getItem(META_KEY) || '{}').lastRemoteAt || 0);
  let pushInFlight = null;
  let pullInFlight = null;

  const readFields = (ids) => Object.fromEntries(ids.map(id => {
    const el = document.getElementById(id);
    return [id, el ? el.value : ''];
  }));

  const writeFields = (values, ids) => {
    if (!values || typeof values !== 'object') return;
    ids.forEach(id => {
      if (!(id in values)) return;
      const el = document.getElementById(id);
      if (!el) return;
      const next = values[id] == null ? '' : String(values[id]);
      if (el.value !== next) el.value = next;
    });
  };

  const saveMeta = () => {
    localStorage.setItem(META_KEY, JSON.stringify({ lastRemoteAt }));
  };

  function collectSharedState() {
    const quoteDraft = readFields(quoteIds);
    const calculatorDraft = readFields(calcIds);
    localStorage.setItem(QUOTE_KEY, JSON.stringify(quoteDraft));
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(calculatorDraft));

    return {
      version: 2,
      config: appConfig,
      filaments: appFilaments,
      orders: appOrders,
      quoteDraft,
      calculatorDraft,
      updatedAt: new Date().toISOString()
    };
  }

  function refreshAfterCloudApply() {
    try { ensureConfigChannels(); } catch (_) {}
    try { loadSettingsUI(); } catch (_) {}
    try { renderChannelOptions(); } catch (_) {}
    try { renderFilamentSelect(); } catch (_) {}
    try { renderFilamentList(); } catch (_) {}
    try { renderOrders(); } catch (_) {}
    try {
      if (document.getElementById('listContainer')?.style.display === 'block') renderOrderListView();
    } catch (_) {}
    try { calculatePrices(); } catch (_) {}
    try { updateQuotePreview(); } catch (_) {}
  }

  function applySharedState(payload) {
    if (!payload || typeof payload !== 'object') return false;
    suppressLocalEvents = true;
    try {
      if (payload.config && typeof payload.config === 'object') appConfig = payload.config;
      if (Array.isArray(payload.filaments)) appFilaments = payload.filaments;
      if (Array.isArray(payload.orders)) appOrders = payload.orders;

      localStorage.setItem(DB_KEYS.CONFIG, JSON.stringify(appConfig));
      localStorage.setItem(DB_KEYS.FILAMENTS, JSON.stringify(appFilaments));
      localStorage.setItem(DB_KEYS.ORDERS, JSON.stringify(appOrders));

      if (payload.quoteDraft) {
        localStorage.setItem(QUOTE_KEY, JSON.stringify(payload.quoteDraft));
        writeFields(payload.quoteDraft, quoteIds);
      }
      if (payload.calculatorDraft) {
        localStorage.setItem(WORKSPACE_KEY, JSON.stringify(payload.calculatorDraft));
        writeFields(payload.calculatorDraft, calcIds);
      }

      refreshAfterCloudApply();
      return true;
    } finally {
      suppressLocalEvents = false;
    }
  }

  function restoreDraftsFromLocal() {
    try { writeFields(JSON.parse(localStorage.getItem(QUOTE_KEY) || '{}'), quoteIds); } catch (_) {}
    try { writeFields(JSON.parse(localStorage.getItem(WORKSPACE_KEY) || '{}'), calcIds); } catch (_) {}
    refreshAfterCloudApply();
  }

  async function authRequest(path, { method = 'GET', body = null, token = null } = {}) {
    const headers = { apikey: appCloud.key, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(appCloud.url + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null,
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.msg || data?.message || data?.error_description || `Erro ${response.status}`);
    return data;
  }

  function persistCloudSession() {
    localStorage.setItem(DB_KEYS.CLOUD, JSON.stringify(appCloud));
  }

  async function hydrateOAuthCallback() {
    const hash = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
    const accessToken = hash.get('access_token');
    if (!accessToken) return false;

    const refreshToken = hash.get('refresh_token') || '';
    const expiresIn = Number(hash.get('expires_in') || 3600);
    const user = await authRequest('/auth/v1/user', { token: accessToken });
    appCloud.session = {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: hash.get('token_type') || 'bearer',
      expires_in: expiresIn,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
      user
    };
    persistCloudSession();
    history.replaceState({}, document.title, window.location.pathname + window.location.search);
    return true;
  }

  async function ensureFreshSession() {
    if (!appCloud?.session?.access_token) return false;
    try {
      const user = await authRequest('/auth/v1/user', { token: appCloud.session.access_token });
      appCloud.session.user = user;
      persistCloudSession();
      return true;
    } catch (_) {
      if (!appCloud.session.refresh_token) return false;
      try {
        const refreshed = await authRequest('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST',
          body: { refresh_token: appCloud.session.refresh_token }
        });
        appCloud.session = refreshed;
        persistCloudSession();
        return Boolean(refreshed?.access_token && refreshed?.user?.id);
      } catch (_) {
        appCloud.session = null;
        persistCloudSession();
        return false;
      }
    }
  }

  async function cloudPushV2({ silent = false } = {}) {
    if (pushInFlight) return pushInFlight;
    if (!appCloud?.session?.user?.id || !appCloud?.session?.access_token) {
      if (!silent) showToast('Entre na Nuvem para sincronizar entre seus aparelhos.');
      return false;
    }

    pushInFlight = (async () => {
      setCloudStatus('syncing', 'Sincronizando...');
      try {
        const payload = collectSharedState();
        const stamp = new Date().toISOString();
        await supabaseReq('/rest/v1/taverna_state?on_conflict=user_id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates' },
          body: { user_id: appCloud.session.user.id, payload, updated_at: stamp }
        });
        lastRemoteAt = Date.parse(stamp) || Date.now();
        saveMeta();
        setCloudStatus('ok', 'Nuvem Conectada');
        if (!silent) showToast('Tudo sincronizado na nuvem!', true);
        return true;
      } catch (err) {
        setCloudStatus('bad', 'Erro na Sincronização');
        if (!silent) showToast(err.message || 'Falha ao sincronizar com o Supabase.');
        return false;
      } finally {
        pushInFlight = null;
      }
    })();
    return pushInFlight;
  }

  async function cloudPullV2({ silent = false, force = false } = {}) {
    if (pullInFlight) return pullInFlight;
    if (!appCloud?.session?.user?.id || !appCloud?.session?.access_token) {
      if (!silent) showToast('Entre na Nuvem para carregar seus dados.');
      return false;
    }

    pullInFlight = (async () => {
      if (!silent) setCloudStatus('syncing', 'Baixando...');
      try {
        const rows = await supabaseReq(`/rest/v1/taverna_state?user_id=eq.${encodeURIComponent(appCloud.session.user.id)}&select=payload,updated_at`);
        const row = rows?.[0];
        if (!row?.payload) {
          await cloudPushV2({ silent: true });
          return true;
        }

        const remoteAt = Date.parse(row.updated_at || row.payload.updatedAt || 0) || 0;
        const localDirty = lastLocalChangeAt > lastRemoteAt;
        if (!force && remoteAt <= lastRemoteAt) return true;
        if (!force && localDirty && lastLocalChangeAt >= remoteAt) {
          await cloudPushV2({ silent: true });
          return true;
        }

        applySharedState(row.payload);
        lastRemoteAt = remoteAt || Date.now();
        saveMeta();
        setCloudStatus('ok', 'Nuvem Conectada');
        if (!silent) showToast('Dados atualizados da nuvem!', true);
        return true;
      } catch (err) {
        setCloudStatus('bad', 'Falha ao baixar');
        if (!silent) showToast(err.message || 'Erro ao consultar o Supabase.');
        return false;
      } finally {
        pullInFlight = null;
      }
    })();
    return pullInFlight;
  }

  function schedulePush() {
    if (suppressLocalEvents || !appCloud?.session?.access_token) return;
    lastLocalChangeAt = Date.now();
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => cloudPushV2({ silent: true }), SYNC_DELAY_MS);
  }

  function installFieldSync() {
    [...quoteIds, ...calcIds].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const onChange = () => {
        if (suppressLocalEvents) return;
        if (quoteIds.includes(id)) localStorage.setItem(QUOTE_KEY, JSON.stringify(readFields(quoteIds)));
        if (calcIds.includes(id)) localStorage.setItem(WORKSPACE_KEY, JSON.stringify(readFields(calcIds)));
        schedulePush();
      };
      el.addEventListener('input', onChange);
      el.addEventListener('change', onChange);
    });
  }

  function startPolling() {
    clearTimeout(pollTimer);
    const tick = async () => {
      if (document.visibilityState === 'visible' && appCloud?.session?.access_token) {
        await cloudPullV2({ silent: true });
      }
      pollTimer = setTimeout(tick, POLL_MS);
    };
    pollTimer = setTimeout(tick, POLL_MS);
  }

  async function boot() {
    restoreDraftsFromLocal();
    installFieldSync();

    // Substitui a sincronização antiga por esta versão completa.
    cloudPush = () => cloudPushV2({ silent: false });
    cloudPull = () => cloudPullV2({ silent: false, force: true });
    triggerCloudAutoSync = schedulePush;

    try { await hydrateOAuthCallback(); } catch (e) { console.warn('[Supabase OAuth]', e); }
    const logged = await ensureFreshSession();
    if (logged) {
      setCloudStatus('ok', 'Nuvem Conectada');
      await cloudPullV2({ silent: true, force: true });
    } else {
      setCloudStatus('', 'Local');
    }

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && appCloud?.session?.access_token) cloudPullV2({ silent: true });
    });
    window.addEventListener('focus', () => {
      if (appCloud?.session?.access_token) cloudPullV2({ silent: true });
    });
    window.addEventListener('online', () => {
      if (appCloud?.session?.access_token) cloudPullV2({ silent: true });
    });
    startPolling();
  }

  window.__tavernaCloudSync = {
    collectSharedState,
    applySharedState,
    push: cloudPushV2,
    pull: cloudPullV2,
    schedulePush,
    quoteIds: [...quoteIds],
    calcIds: [...calcIds]
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
