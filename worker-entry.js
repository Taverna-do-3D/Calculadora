import baseWorker from './worker.js';
import { connect } from 'cloudflare:sockets';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Max-Age': '86400',
};

const BAMBU_API = 'https://api.bambulab.com';
const BAMBU_MQTT_HOST = 'us.mqtt.bambulab.com';
const BAMBU_MQTT_PORT = 8883;
const enc = new TextEncoder();
const dec = new TextDecoder();

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

function concatBytes(...parts) {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

function mqttString(value) {
  const b = enc.encode(String(value));
  return concatBytes(new Uint8Array([(b.length >> 8) & 0xff, b.length & 0xff]), b);
}

function remainingLength(length) {
  const out = [];
  do {
    let digit = length % 128;
    length = Math.floor(length / 128);
    if (length > 0) digit |= 0x80;
    out.push(digit);
  } while (length > 0);
  return new Uint8Array(out);
}

function packet(header, body) {
  return concatBytes(new Uint8Array([header]), remainingLength(body.length), body);
}

function connectPacket(clientId, username, password) {
  const variableHeader = concatBytes(mqttString('MQTT'), new Uint8Array([0x04, 0xC2, 0x00, 0x3C]));
  const payload = concatBytes(mqttString(clientId), mqttString(username), mqttString(password));
  return packet(0x10, concatBytes(variableHeader, payload));
}

function subscribePacket(topic, packetId = 1) {
  return packet(0x82, concatBytes(
    new Uint8Array([(packetId >> 8) & 0xff, packetId & 0xff]),
    mqttString(topic),
    new Uint8Array([0x00])
  ));
}

function publishPacket(topic, payload) {
  return packet(0x30, concatBytes(mqttString(topic), enc.encode(payload)));
}

function createPacketReader(readable) {
  const reader = readable.getReader();
  let buffer = new Uint8Array(0);
  async function readMore() {
    const { value, done } = await reader.read();
    if (done) throw new Error('Conexão MQTT encerrada.');
    buffer = concatBytes(buffer, value instanceof Uint8Array ? value : new Uint8Array(value));
  }
  return {
    async next() {
      while (buffer.length < 2) await readMore();
      let multiplier = 1, remaining = 0, index = 1, digit;
      do {
        while (buffer.length <= index) await readMore();
        digit = buffer[index++];
        remaining += (digit & 127) * multiplier;
        multiplier *= 128;
      } while (digit & 128);
      const total = index + remaining;
      while (buffer.length < total) await readMore();
      const raw = buffer.slice(0, total);
      buffer = buffer.slice(total);
      return { type: raw[0] >> 4, flags: raw[0] & 0x0f, headerLength: index, raw };
    },
    release() { try { reader.releaseLock(); } catch (_) {} }
  };
}

function parsePublish(p) {
  let offset = p.headerLength;
  if (offset + 2 > p.raw.length) return null;
  const topicLen = (p.raw[offset] << 8) | p.raw[offset + 1];
  offset += 2;
  if (offset + topicLen > p.raw.length) return null;
  const topic = dec.decode(p.raw.slice(offset, offset + topicLen));
  offset += topicLen;
  const qos = (p.flags >> 1) & 0x03;
  if (qos > 0) offset += 2;
  return { topic, payload: dec.decode(p.raw.slice(offset)) };
}

function timeout(promise, ms, message) {
  let timer;
  const t = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

function num(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fanPercent(value) {
  const n = num(value);
  if (n === null) return null;
  if (n <= 15) return Math.round((n / 15) * 100);
  if (n <= 100) return Math.round(n);
  if (n <= 255) return Math.round((n / 255) * 100);
  return Math.round(n);
}

function speedName(level) {
  return ({ 1: 'Silencioso', 2: 'Padrão', 3: 'Esporte', 4: 'Ludicrous' })[Number(level)] || null;
}

function normalize(p) {
  return {
    state: String(p.gcode_state || p.print_status || p.state || '').toUpperCase() || null,
    fileName: p.subtask_name || p.gcode_file || p.file || p.task_name || null,
    percent: num(p.mc_percent ?? p.progress ?? p.percent),
    remainingMins: num(p.mc_remaining_time ?? p.remaining_time ?? p.remain_time),
    currentLayer: num(p.layer_num ?? p.current_layer),
    totalLayers: num(p.total_layer_num ?? p.total_layers),
    nozzleTemp: num(p.nozzle_temper ?? p.nozzle_temp),
    nozzleTarget: num(p.nozzle_target_temper ?? p.nozzle_target),
    bedTemp: num(p.bed_temper ?? p.bed_temp),
    bedTarget: num(p.bed_target_temper ?? p.bed_target),
    fanSpeed: fanPercent(p.cooling_fan_speed ?? p.fan_speed),
    auxiliaryFanSpeed: fanPercent(p.big_fan1_speed),
    chamberFanSpeed: fanPercent(p.big_fan2_speed),
    speedMode: speedName(p.spd_lvl ?? p.speed_level),
    speedLevel: num(p.spd_lvl ?? p.speed_level),
    speedPct: num(p.spd_mag ?? p.speed_mag ?? p.speed_pct),
    wifiSignal: p.wifi_signal ?? null,
  };
}

async function getUserId(token) {
  const r = await fetch(`${BAMBU_API}/v1/design-user-service/my/preference`, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'BambuStudio/01.09.03.50', Accept: 'application/json' },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.message || 'Falha ao obter user_id Bambu.');
  const uid = d.uid ?? d.userId ?? d.id;
  if (!uid) throw new Error('user_id Bambu não encontrado.');
  return String(uid);
}

async function mqttTelemetry(token, devId, userId) {
  const uid = String(userId || '').trim() || await getUserId(token);
  const socket = connect({ hostname: BAMBU_MQTT_HOST, port: BAMBU_MQTT_PORT }, { secureTransport: 'on', allowHalfOpen: false });
  await timeout(socket.opened, 7000, 'Timeout ao abrir MQTT.');
  const writer = socket.writable.getWriter();
  const reader = createPacketReader(socket.readable);
  const reportTopic = `device/${devId}/report`;
  const requestTopic = `device/${devId}/request`;
  const clientId = `taverna3d_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;

  try {
    await writer.write(connectPacket(clientId, `u_${uid}`, token));
    const ack = await timeout(reader.next(), 6000, 'MQTT não respondeu ao login.');
    if (ack.type !== 2 || ack.raw[ack.raw.length - 1] !== 0) {
      throw new Error(`Login MQTT recusado (código ${ack.raw[ack.raw.length - 1]}).`);
    }

    await writer.write(subscribePacket(reportTopic));
    // Aguarda SUBACK quando chegar, sem bloquear o fluxo se houver outro pacote primeiro.
    await writer.write(publishPacket(requestTopic, JSON.stringify({
      pushing: { sequence_id: String(Date.now()), command: 'pushall', version: 1, push_target: 1 }
    })));

    const mergedPrint = {};
    const rawMessages = [];
    const started = Date.now();
    let firstPrintAt = 0;

    while (Date.now() - started < 6500) {
      let p;
      try {
        p = await timeout(reader.next(), firstPrintAt ? 1200 : 2500, 'Sem novo pacote MQTT.');
      } catch (_) {
        if (firstPrintAt) break;
        continue;
      }
      if (p.type !== 3) continue;
      const pub = parsePublish(p);
      if (!pub || pub.topic !== reportTopic) continue;
      let json;
      try { json = JSON.parse(pub.payload); } catch (_) { continue; }
      if (!json?.print || typeof json.print !== 'object') continue;
      if (!firstPrintAt) firstPrintAt = Date.now();
      Object.assign(mergedPrint, json.print);
      rawMessages.push(json.print);

      const hasSensors = mergedPrint.nozzle_temper !== undefined && mergedPrint.bed_temper !== undefined;
      const hasCore = mergedPrint.mc_percent !== undefined || mergedPrint.layer_num !== undefined || mergedPrint.gcode_state !== undefined;
      if (hasSensors && hasCore && Date.now() - firstPrintAt > 500) break;
    }

    if (!Object.keys(mergedPrint).length) throw new Error('A A1 não enviou nenhum bloco print pelo MQTT.');

    return {
      userId: uid,
      telemetry: normalize(mergedPrint),
      mergedPrint,
      packetCount: rawMessages.length,
    };
  } finally {
    reader.release();
    try { writer.releaseLock(); } catch (_) {}
    try { await socket.close(); } catch (_) {}
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/bambu/telemetry' || request.method !== 'POST') {
      return baseWorker.fetch(request, env, ctx);
    }

    try {
      const body = await request.json().catch(() => ({}));
      const { token, dev_id, user_id } = body;
      if (!token || !dev_id) return jsonResponse({ success: false, error: 'Token e ID da impressora são obrigatórios.' }, 400);

      // Mantém o HTTP atual como fallback e metadados do dispositivo/tarefa.
      const fallbackReq = new Request(request.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, dev_id, user_id }),
      });
      const fallbackPromise = baseWorker.fetch(fallbackReq, env, ctx).then(r => r.json()).catch(() => ({}));

      let mqtt = null;
      let mqttError = null;
      try { mqtt = await mqttTelemetry(token, dev_id, user_id); }
      catch (e) { mqttError = e?.message || String(e); }

      const fallback = await fallbackPromise;
      return jsonResponse({
        success: true,
        dev_id,
        source: mqtt ? 'mqtt-delta-merged' : 'http-fallback',
        user_id: mqtt?.userId || fallback.user_id || user_id || '',
        telemetry: mqtt?.telemetry || null,
        device: fallback.device || null,
        task: fallback.task || null,
        all_tasks: fallback.all_tasks || [],
        version: fallback.version || null,
        mqtt_error: mqttError,
        mqtt_packet_count: mqtt?.packetCount || 0,
        mqtt_fields: mqtt ? Object.keys(mqtt.mergedPrint) : [],
      });
    } catch (err) {
      return jsonResponse({ success: false, error: err.message }, 500);
    }
  }
};
