import { connect } from 'cloudflare:sockets';

/**
 * ===================================================================
 *  TAVERNA DO 3D - CALCULADORA 3D WORKER & BAMBU LAB CLOUD RELAY
 * ===================================================================
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Max-Age': '86400',
};

const BAMBU_API = 'https://api.bambulab.com';
const BAMBU_MQTT_HOST = 'us.mqtt.bambulab.com';
const BAMBU_MQTT_PORT = 8883;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
    },
  });
}

function concatBytes(...parts) {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function mqttString(value) {
  const bytes = textEncoder.encode(String(value));
  return concatBytes(new Uint8Array([(bytes.length >> 8) & 0xff, bytes.length & 0xff]), bytes);
}

function mqttRemainingLength(length) {
  const out = [];
  do {
    let digit = length % 128;
    length = Math.floor(length / 128);
    if (length > 0) digit |= 0x80;
    out.push(digit);
  } while (length > 0);
  return new Uint8Array(out);
}

function mqttPacket(header, body) {
  return concatBytes(new Uint8Array([header]), mqttRemainingLength(body.length), body);
}

function mqttConnectPacket(clientId, username, password) {
  const variableHeader = concatBytes(
    mqttString('MQTT'),
    new Uint8Array([0x04, 0xC2, 0x00, 0x3C])
  );
  const payload = concatBytes(mqttString(clientId), mqttString(username), mqttString(password));
  return mqttPacket(0x10, concatBytes(variableHeader, payload));
}

function mqttSubscribePacket(topic, packetId = 1) {
  const body = concatBytes(
    new Uint8Array([(packetId >> 8) & 0xff, packetId & 0xff]),
    mqttString(topic),
    new Uint8Array([0x00])
  );
  return mqttPacket(0x82, body);
}

function mqttPublishPacket(topic, payload) {
  return mqttPacket(0x30, concatBytes(mqttString(topic), textEncoder.encode(payload)));
}

function createMqttPacketReader(readable) {
  const reader = readable.getReader();
  let buffer = new Uint8Array(0);

  async function readMore() {
    const { value, done } = await reader.read();
    if (done) throw new Error('Conexão MQTT encerrada pela Bambu Lab.');
    buffer = concatBytes(buffer, value instanceof Uint8Array ? value : new Uint8Array(value));
  }

  return {
    async nextPacket() {
      while (buffer.length < 2) await readMore();
      let multiplier = 1;
      let remaining = 0;
      let index = 1;
      let digit;
      do {
        while (buffer.length <= index) await readMore();
        digit = buffer[index++];
        remaining += (digit & 127) * multiplier;
        multiplier *= 128;
        if (multiplier > 128 * 128 * 128 * 128) throw new Error('Pacote MQTT inválido.');
      } while (digit & 128);

      const totalLength = index + remaining;
      while (buffer.length < totalLength) await readMore();
      const packet = buffer.slice(0, totalLength);
      buffer = buffer.slice(totalLength);
      return { type: packet[0] >> 4, flags: packet[0] & 0x0f, headerLength: index, packet };
    },
    release() {
      try { reader.releaseLock(); } catch (_) {}
    }
  };
}

function parsePublishPacket(parsed) {
  const { packet, headerLength, flags } = parsed;
  let offset = headerLength;
  if (offset + 2 > packet.length) return null;
  const topicLength = (packet[offset] << 8) | packet[offset + 1];
  offset += 2;
  if (offset + topicLength > packet.length) return null;
  const topic = textDecoder.decode(packet.slice(offset, offset + topicLength));
  offset += topicLength;
  const qos = (flags >> 1) & 0x03;
  if (qos > 0) offset += 2;
  if (offset > packet.length) return null;
  return { topic, payload: textDecoder.decode(packet.slice(offset)) };
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function nullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fanToPercent(value) {
  const n = nullableNumber(value);
  if (n === null) return null;
  if (n <= 15) return Math.round((n / 15) * 100);
  if (n <= 100) return Math.round(n);
  if (n <= 255) return Math.round((n / 255) * 100);
  return Math.round(n);
}

function speedModeName(level) {
  const n = Number(level);
  return ({ 1: 'Silencioso', 2: 'Padrão', 3: 'Esporte', 4: 'Ludicrous' })[n] || null;
}

function normalizeBambuTelemetry(report) {
  const p = report?.print || report?.pushing || report || {};
  const state = String(p.gcode_state || p.print_status || p.state || '').toUpperCase() || null;
  const remainingMins = nullableNumber(p.mc_remaining_time ?? p.remaining_time ?? p.remain_time);
  const speedPct = nullableNumber(p.spd_mag ?? p.speed_mag ?? p.speed_pct);
  const speedLevel = nullableNumber(p.spd_lvl ?? p.speed_level);

  return {
    state,
    fileName: p.subtask_name || p.gcode_file || p.file || p.task_name || null,
    percent: nullableNumber(p.mc_percent ?? p.progress ?? p.percent),
    remainingMins,
    currentLayer: nullableNumber(p.layer_num ?? p.current_layer),
    totalLayers: nullableNumber(p.total_layer_num ?? p.total_layers),
    nozzleTemp: nullableNumber(p.nozzle_temper ?? p.nozzle_temp),
    nozzleTarget: nullableNumber(p.nozzle_target_temper ?? p.nozzle_target),
    bedTemp: nullableNumber(p.bed_temper ?? p.bed_temp),
    bedTarget: nullableNumber(p.bed_target_temper ?? p.bed_target),
    fanSpeed: fanToPercent(p.cooling_fan_speed ?? p.fan_speed),
    auxiliaryFanSpeed: fanToPercent(p.big_fan1_speed),
    chamberFanSpeed: fanToPercent(p.big_fan2_speed),
    speedMode: speedModeName(speedLevel),
    speedLevel,
    speedPct,
    wifiSignal: p.wifi_signal ?? null,
  };
}

async function getBambuUserId(token) {
  const res = await fetch(`${BAMBU_API}/v1/design-user-service/my/preference`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'BambuStudio/01.09.03.50',
      'Accept': 'application/json',
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Não foi possível obter o ID da conta Bambu Lab.');
  return String(data.uid || data.userId || data.id || '').trim();
}

async function fetchBambuMqttReport({ token, devId, userId }) {
  const uid = String(userId || '').trim() || await getBambuUserId(token);
  if (!uid) throw new Error('ID da conta Bambu Lab não encontrado.');

  const socket = connect(
    { hostname: BAMBU_MQTT_HOST, port: BAMBU_MQTT_PORT },
    { secureTransport: 'on', allowHalfOpen: false }
  );
  await withTimeout(socket.opened, 7000, 'Tempo esgotado ao conectar ao MQTT da Bambu Lab.');

  const writer = socket.writable.getWriter();
  const packetReader = createMqttPacketReader(socket.readable);
  const reportTopic = `device/${devId}/report`;
  const requestTopic = `device/${devId}/request`;
  const clientId = `taverna3d_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;

  try {
    await writer.write(mqttConnectPacket(clientId, `u_${uid}`, token));
    const connAck = await withTimeout(packetReader.nextPacket(), 6000, 'A Bambu Lab não respondeu ao login MQTT.');
    if (connAck.type !== 2 || connAck.packet[connAck.packet.length - 1] !== 0) {
      const returnCode = connAck.packet[connAck.packet.length - 1];
      throw new Error(`Login MQTT recusado pela Bambu Lab (código ${returnCode}).`);
    }

    await writer.write(mqttSubscribePacket(reportTopic));
    const pushAll = JSON.stringify({
      pushing: {
        sequence_id: String(Date.now()),
        command: 'pushall',
        version: 1,
        push_target: 1,
      },
    });
    await writer.write(mqttPublishPacket(requestTopic, pushAll));

    const report = await withTimeout((async () => {
      while (true) {
        const packet = await packetReader.nextPacket();
        if (packet.type !== 3) continue;
        const published = parsePublishPacket(packet);
        if (!published || published.topic !== reportTopic) continue;
        try {
          const json = JSON.parse(published.payload);
          if (json?.print || json?.pushing) return json;
        } catch (_) {}
      }
    })(), 8000, 'A A1 não enviou a telemetria completa a tempo.');

    return { report, userId: uid, telemetry: normalizeBambuTelemetry(report) };
  } finally {
    packetReader.release();
    try { writer.releaseLock(); } catch (_) {}
    try { await socket.close(); } catch (_) {}
  }
}

async function getHttpFallback(token, devId) {
  const [taskRes1, taskRes2, bindRes, devRes] = await Promise.allSettled([
    fetch(`${BAMBU_API}/v1/iot-service/api/user/device/task?dev_id=${encodeURIComponent(devId)}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'BambuStudio/01.09.03.50', 'Accept': 'application/json' }
    }).then(r => r.json()).catch(() => ({})),
    fetch(`${BAMBU_API}/v1/iot-service/api/user/device/task?deviceId=${encodeURIComponent(devId)}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'BambuStudio/01.09.03.50', 'Accept': 'application/json' }
    }).then(r => r.json()).catch(() => ({})),
    fetch(`${BAMBU_API}/v1/iot-service/api/user/bind`, {
      headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'BambuStudio/01.09.03.50', 'Accept': 'application/json' }
    }).then(r => r.json()).catch(() => ({})),
    fetch(`${BAMBU_API}/v1/iot-service/api/user/device/version?dev_id=${encodeURIComponent(devId)}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'BambuStudio/01.09.03.50', 'Accept': 'application/json' }
    }).then(r => r.json()).catch(() => ({}))
  ]);

  const taskData1 = taskRes1.status === 'fulfilled' ? taskRes1.value : {};
  const taskData2 = taskRes2.status === 'fulfilled' ? taskRes2.value : {};
  const bindData = bindRes.status === 'fulfilled' ? bindRes.value : {};
  const devData = devRes.status === 'fulfilled' ? devRes.value : {};
  const rawDevices = bindData.devices || bindData.data || [];
  const device = rawDevices.find(d => (d.dev_id === devId || d.sn === devId || d.device_id === devId)) || rawDevices[0] || null;
  const hits = taskData1.hits || taskData1.tasks || taskData2.hits || taskData2.tasks || [];
  const task = hits[0] || taskData1.task || taskData2.task || null;
  return { device, task, all_tasks: hits, version: devData, raw: { taskData1, taskData2, bindData, devData } };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === '/api/bambu/login' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const { account, password, tfa_code, code } = body;
        if (!account || !password) {
          return jsonResponse({ success: false, error: 'E-mail e senha da Bambu Lab são obrigatórios.' }, 400);
        }

        const verificationCode = String(tfa_code || code || '').trim();
        const payload = { account: account.trim(), password: password.trim() };
        if (verificationCode) {
          payload.tfa_code = verificationCode;
          payload.code = verificationCode;
          payload.tfaCode = verificationCode;
          payload.verifyCode = verificationCode;
        }

        const bambuRes = await fetch(`${BAMBU_API}/v1/user-service/user/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'BambuStudio/01.09.03.50', 'Accept': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await bambuRes.json().catch(() => ({}));

        const msg = ((data.message || '') + ' ' + (data.error || '') + ' ' + (data.msg || '') + ' ' + (data.description || '')).toLowerCase();
        const codeVal = String(data.code || '');
        const is2fa = msg.includes('2fa') || msg.includes('tfa') || msg.includes('verif') || msg.includes('código') || msg.includes('codigo') || msg.includes('code') || msg.includes('otp') || codeVal.includes('40010026') || data.tfa_code_required || data.require_2fa || data.require2fa;

        if (!bambuRes.ok || !data.accessToken) {
          if (is2fa) {
            return jsonResponse({ success: false, require2fa: true, message: 'A Bambu Lab enviou um código de verificação para o seu e-mail. Digite o código para continuar.' }, 200);
          }
          return jsonResponse({ success: false, error: data.message || data.error || 'Falha ao autenticar na Bambu Lab. Verifique seu e-mail e senha.' }, 401);
        }

        let userId = String(data.userId || data.uid || '').trim();
        if (!userId) {
          try { userId = await getBambuUserId(data.accessToken); } catch (_) {}
        }

        return jsonResponse({
          success: true,
          token: data.accessToken,
          userId,
          username: data.username || data.name || account.split('@')[0],
          email: account,
        });
      } catch (err) {
        return jsonResponse({ success: false, error: 'Erro de conexão com o servidor da Bambu Lab: ' + err.message }, 500);
      }
    }

    if (url.pathname === '/api/bambu/devices' && (request.method === 'GET' || request.method === 'POST')) {
      try {
        let token = request.headers.get('Authorization')?.replace('Bearer ', '')?.trim();
        if (!token && request.method === 'POST') {
          const body = await request.json().catch(() => ({}));
          token = body.token;
        }
        if (!token) return jsonResponse({ success: false, error: 'Token de autenticação não fornecido.' }, 401);

        const bambuRes = await fetch(`${BAMBU_API}/v1/iot-service/api/user/bind`, {
          headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'BambuStudio/01.09.03.50', 'Accept': 'application/json' },
        });
        const data = await bambuRes.json().catch(() => ({}));
        if (!bambuRes.ok) return jsonResponse({ success: false, error: data.message || 'Erro ao buscar impressoras.' }, bambuRes.status);

        const rawDevices = data.devices || data.data || [];
        const devices = rawDevices.map(d => {
          const onlineValue = d.online ?? d.dev_online;
          const status = d.print_status || d.task_status || (onlineValue ? 'IDLE' : 'OFFLINE');
          return {
            dev_id: d.dev_id || d.devId || d.sn || d.device_id || d.deviceId || '',
            name: d.name || d.dev_name || d.nick_name || 'Bambu Lab A1',
            model: d.dev_model_name || d.dev_product_name || d.model || 'A1',
            online: Boolean(onlineValue),
            access_code: d.dev_access_code || d.access_code || '',
            nozzle_diameter: Number(d.nozzle_diameter || 0.4),
            is_printing: status === 'RUNNING' || status === 'PRINTING',
            print_status: status,
            raw: d,
          };
        });
        return jsonResponse({ success: true, devices, raw: data });
      } catch (err) {
        return jsonResponse({ success: false, error: 'Erro ao comunicar com Bambu Cloud: ' + err.message }, 500);
      }
    }

    if (url.pathname === '/api/bambu/telemetry' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const { token, dev_id, user_id } = body;
        if (!token || !dev_id) return jsonResponse({ success: false, error: 'Token e ID da impressora são obrigatórios.' }, 400);

        const fallbackPromise = getHttpFallback(token, dev_id);
        let mqtt = null;
        let mqttError = null;
        try {
          mqtt = await fetchBambuMqttReport({ token, devId: dev_id, userId: user_id });
        } catch (err) {
          mqttError = err?.message || String(err);
        }
        const fallback = await fallbackPromise;

        return jsonResponse({
          success: true,
          dev_id,
          source: mqtt ? 'mqtt' : 'http-fallback',
          user_id: mqtt?.userId || user_id || '',
          telemetry: mqtt?.telemetry || null,
          device: fallback.device,
          task: fallback.task,
          all_tasks: fallback.all_tasks,
          version: fallback.version,
          mqtt_error: mqttError,
          raw: { mqtt: mqtt?.report || null, http: fallback.raw },
        });
      } catch (err) {
        return jsonResponse({ success: false, error: err.message }, 500);
      }
    }

    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      const assetResponse = await env.ASSETS.fetch(request);
      const contentType = assetResponse.headers.get('Content-Type') || '';
      if (contentType.includes('text/html')) {
        return new HTMLRewriter()
          .on('body', {
            element(element) {
              element.append('<script src="/bambu-telemetry-patch.js?v=3"></script>', { html: true });
            },
          })
          .transform(assetResponse);
      }
      return assetResponse;
    }

    return new Response('Calculadora Taverna do 3D Online.', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS_HEADERS }
    });
  }
};
