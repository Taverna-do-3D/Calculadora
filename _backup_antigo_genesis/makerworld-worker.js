const ALLOWED_ORIGINS = new Set([
  'https://douglasscaramelli-spec.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000'
]);

const MAKERWORLD_BASE = 'https://makerworld.com';
const BAMBU_API = 'https://api.bambulab.com/v1';
const COMMUNITY_INDEX = 'https://api.tryar.in';
const THINGIVERSE_API = 'https://api.thingiverse.com';
const UA = 'Genesis3D/3.0 (+https://douglasscaramelli-spec.github.io/Corrigido/)';

function cors(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : 'https://douglasscaramelli-spec.github.io';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
function json(data, status = 200, origin = '', extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin), ...extra }
  });
}
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function cleanText(v, max = 180) { return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max); }
function first(...vals) { return vals.find(v => v !== undefined && v !== null && v !== ''); }
function n(v) { const x = Number(v); return Number.isFinite(x) ? x : null; }
function parseMakerWorldId(v) {
  const s = String(v || '');
  const m = s.match(/\/models\/(\d+)/i);
  return m ? m[1] : (/^\d{1,12}$/.test(s) ? s : '');
}
function parseThingiverseId(v) {
  const s = String(v || '');
  const m = s.match(/thing(?:%3A|:)(\d+)/i) || s.match(/\/thing\/(\d+)/i);
  return m ? m[1] : (/^\d{1,12}$/.test(s) ? s : '');
}

function isMakerWorldFamilyHost(host) {
  const h = String(host || '').toLowerCase().replace(/^www\./,'');
  return h === 'makerworld.com' || h.endsWith('.makerworld.com')
    || h === 'bambulab.com' || h.endsWith('.bambulab.com')
    || h === 'bambulab.cn' || h.endsWith('.bambulab.cn');
}
function makerWorldIdFromHtml(html='') {
  const s=String(html||'');
  const patterns=[
    /https?:\/\/(?:[^"'<>]+\.)?makerworld\.com\/[^"'<>]*?\/models\/(\d+)/i,
    /\/models\/(\d+)/i,
    /["'](?:designId|design_id|modelId|model_id)["']\s*[:=]\s*["']?(\d{1,12})/i,
    /<link[^>]+rel=["']canonical["'][^>]+href=["'][^"']*\/models\/(\d+)/i,
    /<meta[^>]+property=["']og:url["'][^>]+content=["'][^"']*\/models\/(\d+)/i
  ];
  for(const p of patterns){const m=s.match(p);if(m)return m[1];}
  return '';
}
async function resolveMakerWorldShare(rawUrl) {
  const raw=String(rawUrl||'').trim();
  const direct=parseMakerWorldId(raw);
  if(direct)return {id:direct,resolvedUrl:`https://makerworld.com/en/models/${direct}`};

  let u;
  try{u=new URL(raw);}catch{throw new Error('Link MakerWorld/Bambu Handy inválido.');}
  if(!isMakerWorldFamilyHost(u.hostname))throw new Error('O link não pertence ao MakerWorld/Bambu Lab.');

  const res=await fetchTimeout(u.toString(),{
    headers:{
      'Accept':'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'User-Agent':UA,
      'Referer':'https://makerworld.com/'
    },
    redirect:'follow'
  },15000);

  const finalUrl=res.url||raw;
  let id=parseMakerWorldId(finalUrl);
  let body='';
  if(!id){
    try{body=await res.text();}catch(_){}
    id=makerWorldIdFromHtml(body);
  }
  if(!id)throw new Error('Não consegui identificar o modelo dentro desse link do Bambu Handy.');
  return {id,resolvedUrl:`https://makerworld.com/en/models/${id}`,finalUrl};
}

function detectSource(v, explicit = '') {
  if (explicit === 'makerworld' || explicit === 'thingiverse') return explicit;
  return /thingiverse\.com/i.test(String(v || '')) ? 'thingiverse' : 'makerworld';
}
async function fetchTimeout(url, options = {}, ms = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}
const commonHeaders = {
  'Accept': 'application/json, text/plain, */*',
  'User-Agent': UA,
  'Referer': 'https://makerworld.com/'
};
function parseTimeMinutes(obj = {}) {
  const direct = n(first(obj.timeMinutes, obj.printTimeMinutes, obj.estimatedMinutes));
  if (direct && direct > 0) return direct;
  const hours = n(first(obj.printTimeHours, obj.timeHours));
  if (hours && hours > 0) return Math.round(hours * 600) / 10;
  const sec = n(first(obj.printTimeSeconds, obj.printingTimeSeconds, obj.estimatedTimeSeconds, obj.prediction));
  if (sec && sec > 0) return Math.round(sec / 6) / 10;
  const raw = first(obj.printTime, obj.printingTime, obj.estimatedTime, obj.time);
  if (typeof raw === 'string') {
    const h = raw.match(/(\d+(?:[.,]\d+)?)\s*h/i), m = raw.match(/(\d+)\s*m/i);
    if (h || m) return (h ? parseFloat(h[1].replace(',', '.')) * 60 : 0) + (m ? parseInt(m[1], 10) : 0);
  }
  return null;
}
function parseWeight(obj = {}) {
  const g = n(first(obj.weightGrams, obj.filamentWeight, obj.totalFilamentWeight, obj.weight, obj.filament_used_g, obj.filamentUsed));
  return g && g > 0 ? Math.round(g * 10) / 10 : null;
}
function normalizePrinter(v) {
  if (!v) return '';
  if (typeof v === 'string') return cleanText(v, 60);
  return cleanText(first(v.name, v.model, v.modelName, v.displayName), 60);
}
function normalizeProfile(p = {}, idx = 0) {
  const meta = p.metadata || p.meta || p.sliceInfo || p.printInfo || {};
  const printer = normalizePrinter(first(p.printer, p.printerName, p.printerModel, p.machine, meta.printer, meta.printerName, meta.machine));
  const layer = first(p.layerHeight, p.layer_height, meta.layerHeight, meta.layer_height);
  const filaments = Array.isArray(p.filaments) ? p.filaments : (Array.isArray(meta.filaments) ? meta.filaments : []);
  const material = cleanText(first(p.material, p.filamentType, meta.material, filaments[0]?.type, filaments[0]?.material), 40);
  const plateCount = n(first(p.plateCount, p.plate_count, p.plates?.length, meta.plateCount));
  return {
    id: String(first(p.id, p.instanceId, p.profileId, p.pid, idx)),
    name: cleanText(first(p.name, p.title, p.profileName, p.instanceName, `Perfil ${idx + 1}`), 100),
    printer,
    layerHeight: layer == null || layer === '' ? '' : String(layer).replace('mm', '').trim(),
    timeMinutes: parseTimeMinutes({ ...meta, ...p }),
    weightGrams: parseWeight({ ...meta, ...p }),
    material,
    plateCount: plateCount && plateCount > 0 ? plateCount : null
  };
}
function normalizeMakerWorld(raw = {}, fallbackUrl = '') {
  const id = String(first(raw.id, raw.designId, raw.design_id, raw.modelIdNumeric, parseMakerWorldId(fallbackUrl), ''));
  const instances = first(raw.instances, raw.printProfiles, raw.profiles, raw.designInstances, raw.plates, []);
  const profiles = Array.isArray(instances) ? instances.map(normalizeProfile) : [];
  const creatorObj = first(raw.creator, raw.user, raw.author, raw.designUser, {});
  const creator = typeof creatorObj === 'string' ? creatorObj : cleanText(first(creatorObj.name, creatorObj.handle, creatorObj.nickname, raw.creatorName, raw.authorName), 80);
  const image = cleanText(first(raw.coverUrl, raw.cover, raw.image, raw.modelImage, raw.thumbnail, raw.thumbnailUrl, raw.images?.[0]?.url, raw.pictures?.[0]), 1000);
  const url = cleanText(first(raw.cleanUrl, raw.url, fallbackUrl, id ? `https://makerworld.com/en/models/${id}` : ''), 1000);
  return {
    modelId: id, id,
    title: cleanText(first(raw.title, raw.name, raw.modelName, raw.titleTranslated, 'Modelo MakerWorld'), 180),
    creator,
    image,
    makerWorldUrl: url,
    publicUrl: url,
    license: cleanText(first(raw.license, raw.licenseName, raw.licenseType, raw.license?.name, raw.licenseInfo?.name), 120),
    commercialUse: cleanText(first(raw.commercialUse, raw.commercial_use), 40) || 'unknown',
    profiles,
    printers: [...new Set(profiles.map(p => p.printer).filter(Boolean))],
    material: cleanText(first(raw.material, profiles.find(p => p.material)?.material), 40),
    source: 'makerworld',
    downloads: n(first(raw.downloads, raw.downloadCount, raw.download_count, raw.downloadNum, raw.statistics?.downloads, raw.stats?.downloads)),
    likes: n(first(raw.likes, raw.likeCount, raw.like_count, raw.statistics?.likes, raw.stats?.likes)),
    publishedAt: first(raw.publishedAt, raw.publishTime, raw.createdAt, raw.createTime, null)
  };
}
async function officialMakerWorldSuggest(query) {
  const url = `${MAKERWORLD_BASE}/api/v1/search-service/suggest2?keyword=${encodeURIComponent(query)}&include=design`;
  const res = await fetchTimeout(url, { headers: commonHeaders }, 9000);
  if (!res.ok) throw new Error(`MakerWorld search ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data.design) ? data.design : (Array.isArray(data.designs) ? data.designs : []);
  return list.map(x => normalizeMakerWorld(x));
}
async function communitySearch(query, sort, page = 1, limit = 40) {
  const mappedSort = sort === 'recent' ? 'recent' : 'popular';
  const url = `${COMMUNITY_INDEX}/api/models?q=${encodeURIComponent(query)}&sort=${mappedSort}&page=${page}&limit=${limit}`;
  const res = await fetchTimeout(url, { headers: { 'Accept': 'application/json', 'User-Agent': UA } }, 9000);
  if (!res.ok) return [];
  const data = await res.json();
  const rows = Array.isArray(data.models) ? data.models : [];
  return rows.map(r => normalizeMakerWorld({
    id: r.modelId, title: r.modelName, modelImage: r.modelImage, creatorName: r.creatorName,
    cleanUrl: r.cleanUrl, license: r.license, profiles: [{
      id: r.profileId, name: r.profileName, printTimeHours: r.printTimeHours,
      weightGrams: r.weightGrams, plateCount: r.plateCount, printer: r.printerName || r.printer
    }], downloads: first(r.downloads, r.downloadCount), likes: first(r.likes, r.likeCount), publishedAt: first(r.publishedAt, r.createdAt)
  }, r.cleanUrl));
}
function dedupe(list) {
  const map = new Map();
  for (const x of list) {
    const key = `${x.source}:${x.modelId || x.publicUrl}`;
    if (!key) continue;
    if (!map.has(key)) map.set(key, x);
    else {
      const prev = map.get(key);
      if ((!prev.profiles?.length && x.profiles?.length) || (!prev.image && x.image)) map.set(key, { ...prev, ...x, profiles: x.profiles?.length ? x.profiles : prev.profiles });
    }
  }
  return [...map.values()];
}
async function searchMakerWorld(query, page, limit, sort) {
  const settled = await Promise.allSettled([
    page === 1 ? officialMakerWorldSuggest(query) : Promise.resolve([]),
    communitySearch(query, sort, page, limit)
  ]);
  const official = settled[0].status === 'fulfilled' ? settled[0].value : [];
  const community = settled[1].status === 'fulfilled' ? settled[1].value : [];
  let all = dedupe([...official, ...community]);
  if (sort === 'downloads') all.sort((a,b)=>(Number(b.downloads)||0)-(Number(a.downloads)||0));
  else if (sort === 'popular') all.sort((a,b)=>(Number(b.likes||b.downloads)||0)-(Number(a.likes||a.downloads)||0));
  else if (sort === 'recent') all.sort((a,b)=>String(b.publishedAt||'').localeCompare(String(a.publishedAt||'')));
  return { items: all.slice(0, limit), hasMore: community.length >= Math.min(limit, 3) };
}
async function fetchMakerWorldModel(id) {
  const primaryUrl = `${BAMBU_API}/design-service/design/${id}`;
  try {
    const res = await fetchTimeout(primaryUrl, { headers: commonHeaders }, 10000);
    if (res.ok) {
      const data = await res.json();
      const model = normalizeMakerWorld(data.design || data.data || data, `https://makerworld.com/en/models/${id}`);
      if (model.title && model.title !== 'Modelo MakerWorld') return model;
    }
  } catch (_) {}
  const fallbackUrl = `${COMMUNITY_INDEX}/api/scrape?url=${encodeURIComponent(`https://makerworld.com/en/models/${id}`)}`;
  const res2 = await fetchTimeout(fallbackUrl, { headers: { 'Accept': 'application/json', 'User-Agent': UA } }, 12000);
  if (!res2.ok) throw new Error(`Não foi possível consultar o MakerWorld (${res2.status})`);
  const data2 = await res2.json();
  return normalizeMakerWorld(data2.model || data2.data || data2, `https://makerworld.com/en/models/${id}`);
}

function thingiverseHeaders(env) {
  const token = String(env.THINGIVERSE_ACCESS_TOKEN || '').trim();
  if (!token) return null;
  return { 'Accept':'application/json', 'Authorization':`Bearer ${token}`, 'User-Agent':UA };
}
function normalizeThingiverse(raw = {}, image = '') {
  const id = String(first(raw.id, raw.thing_id, ''));
  const creatorObj = first(raw.creator, raw.user, {});
  const creator = typeof creatorObj === 'string' ? creatorObj : cleanText(first(creatorObj.name, creatorObj.username, raw.creator_name), 80);
  const print = raw.print_settings || raw.printSettings || {};
  const profile = Object.keys(print).length ? normalizeProfile({
    id:`tv-${id}`, name:'Configurações informadas pelo autor',
    layerHeight:first(print.layer_height, print.layerHeight),
    material:first(print.material, print.filament),
    timeMinutes:first(print.print_time_minutes, print.timeMinutes),
    weightGrams:first(print.filament_weight_g, print.weightGrams)
  }) : null;
  const profiles = profile && (profile.layerHeight || profile.material || profile.timeMinutes || profile.weightGrams) ? [profile] : [];
  const publicUrl = `https://www.thingiverse.com/thing:${id}`;
  return {
    modelId:id, id,
    title:cleanText(first(raw.name, raw.title, `Thing ${id}`), 180),
    creator,
    image:cleanText(first(image, raw.thumbnail, raw.preview_image, raw.default_image?.url, raw.default_image?.sizes?.[0]?.url), 1000),
    thingiverseUrl:publicUrl,
    publicUrl,
    license:cleanText(first(raw.license, raw.license_name),120),
    commercialUse:'unknown',
    profiles,
    printers:[],
    material:profiles[0]?.material || '',
    source:'thingiverse',
    downloads:n(first(raw.download_count, raw.downloads)),
    likes:n(first(raw.like_count, raw.likes)),
    publishedAt:first(raw.added, raw.created_at, raw.published_at, null)
  };
}
async function thingiverseFetch(env, path, timeout = 10000) {
  const headers = thingiverseHeaders(env);
  if (!headers) throw new Error('Thingiverse não configurado: adicione THINGIVERSE_ACCESS_TOKEN aos Secrets do Worker.');
  const res = await fetchTimeout(`${THINGIVERSE_API}${path}`, { headers }, timeout);
  if (!res.ok) throw new Error(`Thingiverse API ${res.status}`);
  return res;
}
async function searchThingiverse(env, query, page, limit, sort) {
  const sortMap = sort === 'recent' ? 'newest' : sort === 'downloads' ? 'popular' : 'relevant';
  const res = await thingiverseFetch(env, `/search/${encodeURIComponent(query)}?type=things&sort=${encodeURIComponent(sortMap)}&page=${page}&per_page=${limit}`);
  const data = await res.json();
  const rows = Array.isArray(data) ? data : (Array.isArray(data.hits) ? data.hits : (Array.isArray(data.things) ? data.things : []));
  const items = rows.map(r => normalizeThingiverse(r));
  return { items, hasMore: rows.length >= limit };
}
async function fetchThingiverseModel(env, id) {
  const res = await thingiverseFetch(env, `/things/${id}`);
  const raw = await res.json();
  let image = '';
  try {
    const ir = await thingiverseFetch(env, `/things/${id}/images?type=display`, 8000);
    const images = await ir.json();
    const firstImage = Array.isArray(images) ? images[0] : null;
    image = first(firstImage?.url, firstImage?.sizes?.find?.(x=>x.type==='display')?.url, firstImage?.sizes?.[0]?.url, '');
  } catch (_) {}
  return normalizeThingiverse(raw, image);
}

function allowedImageHost(host) {
  const h = host.toLowerCase();
  return h === 'makerworld.com' || h.endsWith('.makerworld.com') || h.endsWith('.bambulab.com') || h.endsWith('.bblmw.com') || h.endsWith('.amazonaws.com') || h.endsWith('.thingiverse.com') || h.endsWith('.thingiverseusercontent.com');
}
async function proxyImageUrl(rawUrl, origin) {
  let u;
  try { u = new URL(rawUrl); } catch { return json({ ok:false, error:'URL de imagem inválida' }, 400, origin); }
  if (u.protocol !== 'https:' || !allowedImageHost(u.hostname)) return json({ ok:false, error:'Host de imagem não permitido' }, 403, origin);
  const res = await fetchTimeout(u.toString(), { headers:{ 'User-Agent':UA, 'Accept':'image/*' }, redirect:'follow' }, 12000);
  if (!res.ok) return json({ ok:false, error:'Imagem indisponível' }, 502, origin);
  const ct = res.headers.get('content-type') || 'image/jpeg';
  if (!ct.startsWith('image/')) return json({ ok:false, error:'Conteúdo não é imagem' }, 415, origin);
  return new Response(res.body, { status:200, headers:{ 'Content-Type':ct, 'Cache-Control':'public, max-age=86400', ...cors(origin) } });
}

async function combinedSearch(env, query, page, limit, sort, source) {
  const jobs = [];
  const names = [];
  if (source === 'all' || source === 'makerworld') { names.push('makerworld'); jobs.push(searchMakerWorld(query,page,limit,sort)); }
  if (source === 'all' || source === 'thingiverse') { names.push('thingiverse'); jobs.push(searchThingiverse(env,query,page,limit,sort)); }
  const settled = await Promise.allSettled(jobs);
  const items = [];
  const sources = {};
  let hasMore = false;
  settled.forEach((r,i)=>{
    const name = names[i];
    if (r.status === 'fulfilled') {
      sources[name] = { ok:true, count:r.value.items.length };
      items.push(...r.value.items);
      hasMore ||= !!r.value.hasMore;
    } else sources[name] = { ok:false, count:0, error:cleanText(r.reason?.message || 'indisponível', 120) };
  });
  return { items:dedupe(items).slice(0,limit*2), models:dedupe(items).slice(0,limit*2), hasMore, sources };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:cors(origin)});
    if (request.method !== 'GET') return json({ok:false,error:'Método não permitido'},405,origin);
    if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ok:false,error:'Origem não permitida'},403,origin);
    const url = new URL(request.url);
    try {
      if (url.pathname === '/' || url.pathname === '/health') {
        return json({ok:true,service:'Genesis 3D Model Bridge',version:3,capabilities:{makerworld:true,thingiverse:!!String(env.THINGIVERSE_ACCESS_TOKEN||'').trim()},time:new Date().toISOString()},200,origin);
      }
      if (url.pathname === '/search') {
        const q = cleanText(url.searchParams.get('q'),80);
        if (q.length < 2) return json({ok:false,error:'Busca muito curta'},400,origin);
        const page = clamp(parseInt(url.searchParams.get('page')||'1',10)||1,1,20);
        const limit = clamp(parseInt(url.searchParams.get('limit')||'20',10)||20,1,40);
        const sort = ['relevance','downloads','popular','recent'].includes(url.searchParams.get('sort')) ? url.searchParams.get('sort') : 'relevance';
        const source = ['all','makerworld','thingiverse'].includes(url.searchParams.get('source')) ? url.searchParams.get('source') : 'all';
        const data = await combinedSearch(env,q,page,limit,sort,source);
        return json({ok:true,...data},200,origin,{'Cache-Control':'public, max-age=600'});
      }
      if (url.pathname === '/model' || url.pathname === '/resolve') {
        const raw = url.searchParams.get('url') || url.searchParams.get('id') || '';
        const source = detectSource(raw, url.searchParams.get('source')||'');
        let id='', resolvedUrl='';
        if(source==='thingiverse'){
          id=parseThingiverseId(raw);
          if(!id)return json({ok:false,error:'ID/link do Thingiverse inválido'},400,origin);
        }else{
          const resolved=await resolveMakerWorldShare(raw);
          id=resolved.id;
          resolvedUrl=resolved.resolvedUrl;
        }
        const model = source === 'thingiverse' ? await fetchThingiverseModel(env,id) : await fetchMakerWorldModel(id);
        if(source==='makerworld'&&resolvedUrl){
          model.publicUrl=resolvedUrl;
          model.makerWorldUrl=resolvedUrl;
        }
        return json({ok:true,model,resolvedUrl:resolvedUrl||model.publicUrl||''},200,origin,{'Cache-Control':'public, max-age=3600'});
      }
      if (url.pathname === '/image') {
        const source = detectSource(url.searchParams.get('url')||url.searchParams.get('id'), url.searchParams.get('source')||'');
        const idRaw = url.searchParams.get('id') || '';
        if (idRaw) {
          const id = source === 'thingiverse' ? parseThingiverseId(idRaw) : parseMakerWorldId(idRaw);
          if (!id) return json({ok:false,error:'ID inválido'},400,origin);
          const model = source === 'thingiverse' ? await fetchThingiverseModel(env,id) : await fetchMakerWorldModel(id);
          if (!model.image) return json({ok:false,error:'Modelo sem imagem disponível'},404,origin);
          return proxyImageUrl(model.image,origin);
        }
        return proxyImageUrl(url.searchParams.get('url')||'',origin);
      }
      return json({ok:false,error:'Endpoint inexistente'},404,origin);
    } catch (err) {
      console.error('[Genesis3D Worker]',err);
      const msg = err?.name === 'AbortError' ? 'Tempo limite excedido' : cleanText(err?.message || 'Falha temporária',180);
      return json({ok:false,error:msg},502,origin);
    }
  }
};
