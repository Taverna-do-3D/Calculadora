/*
 * Taverna do 3D — Bambu Lab A1 Telemetry Patch
 * Usa exclusivamente a telemetria MQTT real para sensores e evita valores fictícios/stale.
 */
(() => {
  const POLL_MS = 8000;
  const REQUEST_TIMEOUT_MS = 14000;
  let syncInFlight = null;
  let lastFreshTelemetryAt = 0;

  const removeCameraUI = () => {
    document.getElementById('btnToggleBambuCam')?.remove();
    document.getElementById('bambuCamBox')?.remove();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', removeCameraUI, { once: true });
  } else {
    removeCameraUI();
  }

  const asNumber = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const setIfPresent = (obj, key, value) => {
    if (value !== undefined && value !== null && value !== '') obj[key] = value;
  };

  const clearRealSensors = () => {
    appBambu.nozzleTemp = null;
    appBambu.nozzleTarget = null;
    appBambu.bedTemp = null;
    appBambu.bedTarget = null;
    appBambu.fanSpeed = null;
    appBambu.speedMode = null;
    appBambu.speedPct = null;
  };

  const clearFinishedJob = () => {
    appBambu.fileName = '';
    appBambu.percent = 0;
    appBambu.remainingMins = 0;
    appBambu.currentLayer = null;
    appBambu.totalLayers = null;
  };

  const applyTaskFallback = (task) => {
    if (!task) return false;
    let applied = false;

    const fileName = task.subtask_name || task.title || task.gcode_file || task.design_title;
    if (fileName) {
      appBambu.fileName = fileName;
      applied = true;
    }

    const percent = asNumber(task.percent ?? task.progress);
    if (percent !== null) {
      appBambu.percent = percent;
      applied = true;
    }

    const remaining = task.mc_remaining_time ?? task.remainingMins;
    if (remaining !== undefined && remaining !== null) {
      const n = asNumber(remaining);
      if (n !== null) {
        appBambu.remainingMins = n;
        applied = true;
      }
    } else if (task.total_time && task.cost_time) {
      appBambu.remainingMins = Math.max(0, Math.round((Number(task.total_time) - Number(task.cost_time)) / 60));
      applied = true;
    } else if (task.remain_time) {
      appBambu.remainingMins = Math.max(0, Math.round(Number(task.remain_time) / 60));
      applied = true;
    }

    const currentLayer = asNumber(task.current_layer ?? task.layer_num);
    const totalLayers = asNumber(task.total_layers ?? task.total_layer_num);
    if (currentLayer !== null) {
      appBambu.currentLayer = currentLayer;
      applied = true;
    }
    if (totalLayers !== null) {
      appBambu.totalLayers = totalLayers;
      applied = true;
    }

    return applied;
  };

  const strictSensorRender = (hasRealTelemetry) => {
    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    if (!hasRealTelemetry) {
      setText('bambuNozzleTemp', '--°C');
      setText('bambuNozzleTarget', 'Alvo: --°C');
      setText('bambuBedTemp', '--°C');
      setText('bambuBedTarget', 'Alvo: --°C');
      setText('bambuFanSpeed', '--%');
      setText('bambuSpeedMode', '--');
      setText('bambuSpeedPct', '--');
      return;
    }

    const fmtTemp = (v) => Number.isFinite(asNumber(v)) ? `${Math.round(asNumber(v))}°C` : '--°C';
    const fmtTarget = (v) => Number.isFinite(asNumber(v)) ? `Alvo: ${Math.round(asNumber(v))}°C` : 'Alvo: --°C';
    const fmtPct = (v) => Number.isFinite(asNumber(v)) ? `${Math.round(asNumber(v))}%` : '--%';

    setText('bambuNozzleTemp', fmtTemp(appBambu.nozzleTemp));
    setText('bambuNozzleTarget', fmtTarget(appBambu.nozzleTarget));
    setText('bambuBedTemp', fmtTemp(appBambu.bedTemp));
    setText('bambuBedTarget', fmtTarget(appBambu.bedTarget));
    setText('bambuFanSpeed', fmtPct(appBambu.fanSpeed));
    setText('bambuSpeedMode', appBambu.speedMode || '--');
    setText('bambuSpeedPct', Number.isFinite(asNumber(appBambu.speedPct)) ? `${Math.round(asNumber(appBambu.speedPct))}%` : (appBambu.speedPct || '--'));
  };

  async function doSyncBambuTelemetry(silent = true) {
    if (!appBambu.connected || appBambu.mode !== 'cloud' || !appBambu.token) return;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      if (!appBambu.devId) {
        const dRes = await fetch('/api/bambu/devices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: appBambu.token }),
          signal: controller.signal,
          cache: 'no-store'
        });
        const dData = await dRes.json().catch(() => ({}));
        if (dData.success && dData.devices?.length) {
          const device = dData.devices.find(d => String(d.model || '').includes('A1')) || dData.devices[0];
          appBambu.devId = device.dev_id;
          appBambu.devName = device.name || appBambu.devName;
          appBambu.model = device.model || appBambu.model;
          appBambu.online = Boolean(device.online);
        }
      }

      if (!appBambu.devId) return;

      const res = await fetch('/api/bambu/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: appBambu.token,
          dev_id: appBambu.devId,
          user_id: appBambu.userId || ''
        }),
        signal: controller.signal,
        cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success) throw new Error(data.error || 'Falha ao consultar telemetria.');

      if (data.user_id) appBambu.userId = String(data.user_id);

      if (data.device) {
        const online = data.device.online ?? data.device.dev_online;
        if (online !== undefined) appBambu.online = Boolean(online);
        setIfPresent(appBambu, 'devName', data.device.name || data.device.dev_name);
        setIfPresent(appBambu, 'model', data.device.model || data.device.dev_model_name || data.device.dev_product_name);
      }

      const t = data.telemetry;
      const isMqttSource = String(data.source || '').startsWith('mqtt');
      const hasRealTelemetry = isMqttSource && t && [
        t.nozzleTemp, t.nozzleTarget, t.bedTemp, t.bedTarget,
        t.percent, t.currentLayer, t.totalLayers, t.state
      ].some(v => v !== null && v !== undefined && v !== '');

      if (hasRealTelemetry) {
        lastFreshTelemetryAt = Date.now();
        appBambu.online = true;
        setIfPresent(appBambu, 'state', t.state);
        setIfPresent(appBambu, 'fileName', t.fileName);
        setIfPresent(appBambu, 'percent', asNumber(t.percent));
        setIfPresent(appBambu, 'remainingMins', asNumber(t.remainingMins));
        setIfPresent(appBambu, 'currentLayer', asNumber(t.currentLayer));
        setIfPresent(appBambu, 'totalLayers', asNumber(t.totalLayers));

        appBambu.nozzleTemp = asNumber(t.nozzleTemp);
        appBambu.nozzleTarget = asNumber(t.nozzleTarget);
        appBambu.bedTemp = asNumber(t.bedTemp);
        appBambu.bedTarget = asNumber(t.bedTarget);
        appBambu.fanSpeed = asNumber(t.fanSpeed);
        appBambu.speedMode = t.speedMode || null;
        appBambu.speedPct = asNumber(t.speedPct);
      } else {
        clearRealSensors();
        const hasTaskFallback = applyTaskFallback(data.task);
        if (data.device?.print_status) appBambu.state = data.device.print_status;

        // Se nem MQTT nem tarefa atual vieram, não deixa dados de uma impressão antiga presos indefinidamente.
        if (!hasTaskFallback && lastFreshTelemetryAt && Date.now() - lastFreshTelemetryAt > 30000) {
          clearFinishedJob();
        }
      }

      const normalizedState = String(appBambu.state || '').toUpperCase();
      if (normalizedState === 'PAUSE') appBambu.state = 'PAUSED';
      if (['FINISH', 'SUCCESS', 'IDLE', 'READY'].includes(normalizedState)) {
        appBambu.state = 'IDLE';
        clearFinishedJob();
      }

      saveBambuState();
      updateBambuUI();
      strictSensorRender(hasRealTelemetry);
      removeCameraUI();

      if (!silent) {
        const sourceLabel = hasRealTelemetry ? 'MQTT em tempo real' : 'Bambu Cloud (fallback)';
        showToast(`Telemetria atualizada — ${sourceLabel}! 🔥`, true);
      }

      if (data.mqtt_error) console.warn('[Bambu MQTT fallback]', data.mqtt_error);
    } catch (err) {
      const aborted = err?.name === 'AbortError';
      console.warn('Erro ao sincronizar Bambu:', aborted ? 'timeout da consulta' : err);
      clearRealSensors();
      updateBambuUI();
      strictSensorRender(false);
      removeCameraUI();
      if (!silent) showToast(aborted ? 'A consulta da A1 demorou demais. Tente novamente.' : 'Não foi possível sincronizar a telemetria agora.');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  syncBambuTelemetry = function syncBambuTelemetryReal(silent = true) {
    // Impede duas consultas MQTT simultâneas, evitando resposta antiga sobrescrever a mais nova.
    if (syncInFlight) return syncInFlight;
    syncInFlight = doSyncBambuTelemetry(silent).finally(() => {
      syncInFlight = null;
    });
    return syncInFlight;
  };

  startBambuLoop = function startBambuLoopReal() {
    if (bambuInterval) clearTimeout(bambuInterval);

    const tick = async () => {
      if (appBambu.connected && appBambu.mode === 'cloud') {
        await syncBambuTelemetry(true);
      }
      bambuInterval = setTimeout(tick, POLL_MS);
    };

    tick();
  };

  // Ao voltar para a aba/app ou recuperar a internet, força uma leitura atual imediatamente.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && appBambu?.connected && appBambu?.mode === 'cloud') {
      syncBambuTelemetry(true);
    }
  });

  window.addEventListener('online', () => {
    if (appBambu?.connected && appBambu?.mode === 'cloud') {
      syncBambuTelemetry(true);
    }
  });
})();
