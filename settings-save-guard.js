/* Taverna do 3D — protege edições/salvamentos repetidos da aba Taverna contra pull concorrente */
(() => {
  const settings = document.getElementById('screen-settings');
  const saveBtn = document.getElementById('btnSaveGlobalSettings');
  if (!settings || !saveBtn) return;

  let settingsDirty = false;
  let saveInProgress = false;

  const markDirty = () => {
    settingsDirty = true;
    // Marca alteração local no sincronizador para impedir que um pull remoto
    // redesenhe a tela enquanto o usuário ainda está editando.
    try { window.__tavernaCloudSync?.schedulePush?.(); } catch (_) {}
  };

  settings.addEventListener('input', markDirty, true);
  settings.addEventListener('change', markDirty, true);

  saveBtn.addEventListener('click', () => {
    if (saveInProgress) return;
    saveInProgress = true;
    saveBtn.disabled = true;

    // O listener original do botão roda primeiro e atualiza appConfig/saveLocal.
    // Na microtask seguinte, enviamos exatamente esse novo estado para a nuvem.
    queueMicrotask(async () => {
      try {
        if (typeof window.syncCalibrationIntoConfig === 'function') {
          window.syncCalibrationIntoConfig();
        }
        if (window.__tavernaCloudSync?.push) {
          await window.__tavernaCloudSync.push({ silent: true });
        }
        settingsDirty = false;
      } catch (err) {
        console.warn('[Taverna Save Guard]', err);
      } finally {
        setTimeout(() => {
          saveBtn.disabled = false;
          saveInProgress = false;
        }, 250);
      }
    });
  });

  // Enquanto houver edição não salva, evita que chamadas externas de pull forçado
  // sejam disparadas pelo clique manual na nuvem.
  window.__tavernaSettingsSaveState = {
    get dirty() { return settingsDirty; },
    get saving() { return saveInProgress; }
  };
})();
