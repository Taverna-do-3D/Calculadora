/*
 * Taverna do 3D — sincronização da Calibração Bambu com a Calculadora
 * Garante que potência, tarifa, custo/hora e perdas exibidos na aba Taverna
 * sejam exatamente os valores usados no cálculo.
 */
(() => {
  const parseLocaleNumber = (value, fallback = null) => {
    if (value === undefined || value === null) return fallback;
    const raw = String(value).trim();
    if (!raw) return fallback;
    const normalized = raw.includes(',') && !raw.includes('.')
      ? raw.replace(',', '.')
      : raw.replace(/\.(?=.*\.)/g, '').replace(',', '.');
    const n = Number(normalized);
    return Number.isFinite(n) ? n : fallback;
  };

  const CONFIG_FIELDS = {
    cfgWatts: ['watts', 180],
    cfgEnergyRate: ['energyRate', 0.95],
    cfgMachineCostHour: ['machineCostHour', 2.50],
    cfgFailureRate: ['failureRate', 5]
  };

  function syncCalibrationIntoConfig() {
    if (typeof appConfig !== 'object' || !appConfig) return false;
    let changed = false;

    for (const [id, [key, fallback]] of Object.entries(CONFIG_FIELDS)) {
      const el = document.getElementById(id);
      if (!el) continue;
      const value = parseLocaleNumber(el.value, fallback);
      if (Number.isFinite(value) && appConfig[key] !== value) {
        appConfig[key] = value;
        changed = true;
      }
    }

    const watts = Number(appConfig.watts);
    const energyRow = document.getElementById('costEnergyVal')?.closest('.cost-row');
    const label = energyRow?.querySelector('span');
    if (label && Number.isFinite(watts)) {
      label.textContent = `Energia Elétrica (Bambu A1 ~${Math.round(watts)}W):`;
    }

    return changed;
  }

  window.syncCalibrationIntoConfig = syncCalibrationIntoConfig;

  if (typeof calculatePrices === 'function') {
    const originalCalculatePrices = calculatePrices;
    calculatePrices = function calculatePricesWithLiveCalibration(...args) {
      syncCalibrationIntoConfig();
      return originalCalculatePrices.apply(this, args);
    };
  }

  const recalc = () => {
    syncCalibrationIntoConfig();
    if (typeof calculatePrices === 'function') calculatePrices();
  };

  const bindCalibrationFields = () => {
    Object.keys(CONFIG_FIELDS).forEach(id => {
      const el = document.getElementById(id);
      if (!el || el.dataset.calcCalibrationBound === '1') return;
      el.dataset.calcCalibrationBound = '1';
      el.addEventListener('input', recalc);
      el.addEventListener('change', recalc);
    });

    document.getElementById('btnSaveGlobalSettings')?.addEventListener('click', () => {
      queueMicrotask(recalc);
    });

    recalc();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindCalibrationFields, { once: true });
  } else {
    bindCalibrationFields();
  }
})();
