/*
 * Taverna do 3D — Bambu Lab A1 Telemetry Patch
 * Substitui a leitura parcial via HTTP pela telemetria MQTT normalizada no Worker.
 */
(() => {
  const asNumber = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const setIfPresent = (obj, key, value) => {
    if (value !== undefined && value !== null && value !== '') obj[key] = value;
  };

  const applyTaskFallback = (task) => {
    if (!task) return;
    setIfPresent(appBambu, 'fileName', task.subtask_name || task.title || task.gcode_file || task.design_title);
    setIfPresent(appBambu, 'percent', asNumber(task.percent ?? task.progress));

    const remaining = task.mc_remaining_time ?? task.remainingMins;
    if (remaining !== undefined && remaining !== null) {
      setIfPresent(appBambu, 'remainingMins', asNumber(remaining));
    } else if (task.total_time && task.cost_time) {
      appBambu.remainingMins = Math.max(0, Math.round((Number(task.total_time) - Number(task.cost_time)) / 60));
    } else if (task.remain_time) {
      appBambu.remainingMins = Math.max(0, Math.round(Number(task.remain_time) / 60));
    }

    setIfPresent(appBambu, 'currentLayer', asNumber(task.current_layer ?? task.layer_num));
    setIfPresent(appBambu, 'totalLayers', asNumber(task.total_layers ?? task.total_layer_num));
  };

  syncBambuTelemetry = async function syncBambuTelemetryReal(silent = true) {
    if (!appBambu.connected || appBambu.mode !== 'cloud' || !appBambu.token) return;

    try {
      if (!appBambu.devId) {
        const dRes = await fetch('/api/bambu/devices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: appBambu.token })
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
        })
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
      if (t) {
        appBambu.online = true;
        setIfPresent(appBambu, 'state', t.state);
        setIfPresent(appBambu, 'fileName', t.fileName);
        setIfPresent(appBambu, 'percent', asNumber(t.percent));
        setIfPresent(appBambu, 'remainingMins', asNumber(t.remainingMins));
        setIfPresent(appBambu, 'currentLayer', asNumber(t.currentLayer));
        setIfPresent(appBambu, 'totalLayers', asNumber(t.totalLayers));
        setIfPresent(appBambu, 'nozzleTemp', asNumber(t.nozzleTemp));
        setIfPresent(appBambu, 'nozzleTarget', asNumber(t.nozzleTarget));
        setIfPresent(appBambu, 'bedTemp', asNumber(t.bedTemp));
        setIfPresent(appBambu, 'bedTarget', asNumber(t.bedTarget));
        setIfPresent(appBambu, 'fanSpeed', asNumber(t.fanSpeed));
        setIfPresent(appBambu, 'speedMode', t.speedMode);
        if (t.speedPct !== null && t.speedPct !== undefined) {
          appBambu.speedPct = `${Math.round(Number(t.speedPct))}%`;
        }
      } else {
        applyTaskFallback(data.task);
        if (data.device?.print_status) appBambu.state = data.device.print_status;
      }

      if (appBambu.state === 'PAUSE') appBambu.state = 'PAUSED';
      if (appBambu.state === 'FINISH' || appBambu.state === 'SUCCESS') appBambu.state = 'IDLE';

      saveBambuState();
      updateBambuUI();

      if (!silent) {
        const sourceLabel = data.source === 'mqtt' ? 'MQTT em tempo real' : 'Bambu Cloud (fallback)';
        showToast(`Telemetria atualizada — ${sourceLabel}! 🔥`, true);
      }

      if (data.mqtt_error) console.warn('[Bambu MQTT fallback]', data.mqtt_error);
    } catch (err) {
      console.warn('Erro ao sincronizar Bambu:', err);
      if (!silent) showToast('Não foi possível sincronizar a telemetria agora.');
    }
  };

  startBambuLoop = function startBambuLoopReal() {
    if (bambuInterval) clearInterval(bambuInterval);
    if (appBambu.connected && appBambu.mode === 'cloud') syncBambuTelemetry(true);
    bambuInterval = setInterval(() => {
      if (appBambu.connected && appBambu.mode === 'cloud') syncBambuTelemetry(true);
    }, 10000);
  };
})();
