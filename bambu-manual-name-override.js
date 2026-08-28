/* Taverna do 3D — Nome da peça sempre manual na Calculadora */
(() => {
  function installManualNameGuard() {
    if (typeof window.syncBambuToCalculator !== 'function' || window.syncBambuToCalculator.__manualNameGuard) return false;

    const original = window.syncBambuToCalculator;
    const guarded = function syncBambuToCalculatorManualName(task = null) {
      const item = document.getElementById('calcItemName');
      const manualName = item ? item.value : '';
      const originalFileName = window.appBambu?.fileName;

      try {
        if (window.appBambu) window.appBambu.fileName = '';
        return original.call(this, task);
      } finally {
        if (window.appBambu) window.appBambu.fileName = originalFileName;
        if (item && item.value !== manualName) {
          item.value = manualName;
          item.dispatchEvent(new Event('input', { bubbles: true }));
          item.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    };

    guarded.__manualNameGuard = true;
    window.syncBambuToCalculator = guarded;
    return true;
  }

  if (!installManualNameGuard()) {
    const timer = setInterval(() => {
      if (installManualNameGuard()) clearInterval(timer);
    }, 100);
    setTimeout(() => clearInterval(timer), 10000);
  }
})();
