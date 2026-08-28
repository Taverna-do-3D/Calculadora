/* Taverna do 3D — teste de câmera Bambu Cloud (sem expor credenciais) */
(() => {
  const $ = (id) => document.getElementById(id);

  function setStatus(text, kind = 'info') {
    const el = $('bambuCloudCameraStatus');
    if (!el) return;
    const colors = {
      ok: '#86efac',
      warn: '#fde68a',
      error: '#fca5a5',
      info: 'var(--text-dim)'
    };
    el.style.color = colors[kind] || colors.info;
    el.textContent = text;
  }

  async function testCloudCamera() {
    if (typeof appBambu === 'undefined' || !appBambu?.connected || !appBambu?.token) {
      setStatus('Conecte sua conta Bambu Lab primeiro.', 'warn');
      return;
    }

    if (!appBambu.devId && typeof syncBambuTelemetry === 'function') {
      try { await syncBambuTelemetry(true); } catch (_) {}
    }

    if (!appBambu.devId) {
      setStatus('Não encontrei o ID da sua A1. Atualize a telemetria e tente novamente.', 'warn');
      return;
    }

    const btn = $('btnBambuCloudCameraTest');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Consultando Bambu Cloud...';
    }
    setStatus('Pedindo uma sessão de câmera P2P para a Bambu Cloud...', 'info');

    try {
      const res = await fetch('/api/bambu/camera-cloud-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: appBambu.token, dev_id: appBambu.devId })
      });
      const data = await res.json().catch(() => ({}));

      if (data.success && data.cloud_camera_available) {
        const extras = [];
        if (data.has_uid) extras.push('UID');
        if (data.has_ttcode) extras.push('TTCode');
        if (data.has_auth_key) extras.push('AuthKey');
        if (data.has_password) extras.push('senha de sessão');
        setStatus(`✅ Câmera Cloud disponível! A Bambu devolveu credenciais P2P${extras.length ? ` (${extras.join(', ')})` : ''}. Próxima etapa: abrir o vídeo.`, 'ok');
      } else if (data.success) {
        const fields = Array.isArray(data.camera_fields) && data.camera_fields.length
          ? ` Campos recebidos: ${data.camera_fields.join(', ')}.`
          : '';
        setStatus(`⚠️ A Bambu Cloud respondeu, mas a sessão não veio no formato esperado.${fields}`, 'warn');
      } else {
        const detail = data.bambu_message || data.error || `HTTP ${data.bambu_status || res.status}`;
        setStatus(`❌ A Bambu Cloud não liberou a câmera: ${detail}`, 'error');
      }
    } catch (err) {
      setStatus(`❌ Falha ao testar a câmera Cloud: ${err?.message || err}`, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '☁️ Testar câmera Bambu Cloud';
      }
    }
  }

  function mount() {
    if ($('bambuCloudCameraPanel')) return true;
    const box = $('bambuCamBox');
    if (!box) return false;

    if (typeof appBambu !== 'undefined' && appBambu?.connected) box.style.display = '';

    const panel = document.createElement('div');
    panel.id = 'bambuCloudCameraPanel';
    panel.style.cssText = 'margin-top:10px;padding:12px;border:1px solid #7d5e42;border-radius:12px;background:rgba(43,30,20,.72);';
    panel.innerHTML = `
      <div style="font-size:12px;font-weight:800;color:var(--amber-light);margin-bottom:6px;">☁️ Câmera pela Bambu Cloud — teste P2P</div>
      <div id="bambuCloudCameraStatus" style="font-size:11px;line-height:1.45;color:var(--text-dim);margin-bottom:9px;">Vamos verificar se a nuvem da Bambu libera uma sessão remota de câmera para esta A1.</div>
      <button type="button" id="btnBambuCloudCameraTest" class="btn btn-sm" style="width:100%;background:linear-gradient(135deg,#f59e0b,#d97706);color:#1d1208;font-weight:900;">☁️ Testar câmera Bambu Cloud</button>
      <div style="font-size:9.5px;color:var(--muted);margin-top:7px;line-height:1.35;">O teste não mostra nem grava UID, AuthKey, senha ou TTCode no navegador.</div>
    `;
    box.insertAdjacentElement('afterend', panel);
    $('btnBambuCloudCameraTest')?.addEventListener('click', testCloudCamera);
    return true;
  }

  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    if (mount() || tries > 40) clearInterval(timer);
  }, 250);

  window.testBambuCloudCamera = testCloudCamera;
})();
