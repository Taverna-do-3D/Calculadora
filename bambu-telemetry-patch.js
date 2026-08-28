/*
 * Taverna do 3D — Bambu Lab A1 Telemetry Patch
 * Usa exclusivamente a telemetria MQTT real para sensores e evita valores fictícios/stale.
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

  const REAL_SENSOR_KEYS = [
    'nozzleTemp', 'nozzleTarget', 'bedTemp', 'bedTarget',
    'fanSpeed', 'speedMode', 'speedPct'
  ];

  const clearRealSensors = () => {
    appBambu.nozzleTemp = null;
    appBambu.nozzleTarget = null;
    appBambu.bedTemp = null;
    appBambu.bedTarget = null;
    appBambu.fanSpeed = null;
    appBambu.speedMode = null;
    appBambu.speedPct = null;
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
      const isMqttSource = String(data.source || '').startsWith('mqtt');
      const hasRealTelemetry = isMqttSource && t && [
        t.nozzleTemp, t.nozzleTarget, t.bedTemp, t.bedTarget,
        t.percent, t.currentLayer, t.totalLayers, t.state
      ].some(v => v !== null && v !== undefined && v !== '');

      if (hasRealTelemetry) {
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
        applyTaskFallback(data.task);
        if (data.device?.print_status) appBambu.state = data.device.print_status;
      }

      if (appBambu.state === 'PAUSE') appBambu.state = 'PAUSED';
      if (appBambu.state === 'FINISH' || appBambu.state === 'SUCCESS') appBambu.state = 'IDLE';

      saveBambuState();
      updateBambuUI();
      strictSensorRender(hasRealTelemetry);

      if (!silent) {
        const sourceLabel = hasRealTelemetry ? 'MQTT em tempo real' : 'Bambu Cloud (sem sensores em tempo real)';
        showToast(`Telemetria atualizada — ${sourceLabel}! 🔥`, true);
      }

      if (data.mqtt_error) console.warn('[Bambu MQTT fallback]', data.mqtt_error);
    } catch (err) {
      console.warn('Erro ao sincronizar Bambu:', err);
      clearRealSensors();
      updateBambuUI();
      strictSensorRender(false);
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
