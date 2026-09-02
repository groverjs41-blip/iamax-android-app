'use strict';

const LOVABLE_MATCHES = [
  'https://lovable.dev/*',
  'https://*.lovable.dev/*',
  'https://lovable.app/*',
  'https://*.lovable.app/*'
];

function buildLovableCaptchaRecovery() {
  const backgroundJs = String.raw`
(function () {
  const STORAGE_KEY = 'iamaxLovableCaptchaPausedExtensionIds';
  const PAUSED_AT_KEY = 'iamaxLovableCaptchaPausedAt';
  const TYPES = new Set([
    'IAMAX_CAPTCHA_RECOVERY_STATUS',
    'IAMAX_CAPTCHA_RECOVERY_PAUSE',
    'IAMAX_CAPTCHA_RECOVERY_RESUME'
  ]);

  function getAllExtensions() {
    return new Promise(function (resolve, reject) {
      chrome.management.getAll(function (items) {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(Array.isArray(items) ? items : []);
      });
    });
  }

  function setEnabled(id, enabled) {
    return new Promise(function (resolve, reject) {
      chrome.management.setEnabled(id, enabled, function () {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(true);
      });
    });
  }

  function storageGet(keys) {
    return new Promise(function (resolve) {
      chrome.storage.local.get(keys, function (value) {
        resolve(value || {});
      });
    });
  }

  function storageSet(value) {
    return new Promise(function (resolve) {
      chrome.storage.local.set(value, resolve);
    });
  }

  function storageRemove(keys) {
    return new Promise(function (resolve) {
      chrome.storage.local.remove(keys, resolve);
    });
  }

  function isUsagi(info) {
    if (!info || info.id === chrome.runtime.id || info.type !== 'extension') return false;
    const identity = [info.name, info.shortName, info.description].join(' ').toLowerCase();
    return identity.includes('usagi')
      || (identity.includes('lovable') && identity.includes('unlimited'));
  }

  async function readState() {
    const saved = await storageGet([STORAGE_KEY, PAUSED_AT_KEY]);
    const pausedIds = Array.isArray(saved[STORAGE_KEY])
      ? saved[STORAGE_KEY].filter(function (id) { return /^[a-p]{32}$/i.test(String(id || '')); })
      : [];
    const all = await getAllExtensions();
    const usagi = all.filter(isUsagi).map(function (info) {
      return { id: info.id, name: info.name || 'Usagi', enabled: Boolean(info.enabled) };
    });
    return {
      ok: true,
      pausedIds: pausedIds,
      pausedAt: Number(saved[PAUSED_AT_KEY] || 0),
      usagi: usagi
    };
  }

  async function pauseUsagi() {
    const all = await getAllExtensions();
    const targets = all.filter(function (info) { return isUsagi(info) && info.enabled; });
    if (!targets.length) {
      const state = await readState();
      if (state.pausedIds.length) return state;
      throw new Error('No se encontro Usagi activa');
    }
    const ids = targets.map(function (info) { return info.id; });
    await storageSet({
      [STORAGE_KEY]: ids,
      [PAUSED_AT_KEY]: Date.now()
    });
    for (const id of ids) await setEnabled(id, false);
    return readState();
  }

  async function resumeUsagi() {
    const saved = await storageGet([STORAGE_KEY]);
    let ids = Array.isArray(saved[STORAGE_KEY]) ? saved[STORAGE_KEY] : [];
    if (!ids.length) {
      const all = await getAllExtensions();
      ids = all.filter(isUsagi).map(function (info) { return info.id; });
    }
    if (!ids.length) throw new Error('No se encontro Usagi para reactivar');
    for (const id of ids) await setEnabled(id, true);
    await storageRemove([STORAGE_KEY, PAUSED_AT_KEY]);
    return readState();
  }

  async function handle(msg) {
    if (msg.type === 'IAMAX_CAPTCHA_RECOVERY_PAUSE') return pauseUsagi();
    if (msg.type === 'IAMAX_CAPTCHA_RECOVERY_RESUME') return resumeUsagi();
    return readState();
  }

  globalThis.__iamaxCaptchaRecovery = {
    status: readState,
    pause: pauseUsagi,
    resume: resumeUsagi
  };

  chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
    if (!msg || !TYPES.has(msg.type)) return false;
    handle(msg)
      .then(function (result) { sendResponse(result); })
      .catch(function (error) {
        sendResponse({ ok: false, error: String(error && error.message || error) });
      });
    return true;
  });
})();
`;

  const contentJs = String.raw`
(function () {
  if (window.__iamaxLovableCaptchaRecoveryV1) return;
  window.__iamaxLovableCaptchaRecoveryV1 = true;

  const HOST_ID = 'iamax-lovable-captcha-recovery';
  let paused = false;
  let recoveryStarted = false;
  let shadow = null;

  function send(type) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage({ type: type }, function (result) {
        const err = chrome.runtime.lastError;
        resolve(err ? { ok: false, error: err.message } : (result || { ok: false }));
      });
    });
  }

  function ensureUi() {
    let host = document.getElementById(HOST_ID);
    if (host && shadow) return shadow;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all:initial;position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483647';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML =
      '<style>' +
      '.box{width:min(560px,calc(100vw - 28px));box-sizing:border-box;padding:14px 16px;border:1px solid #7c5cff;border-radius:14px;background:#130c24;color:#fff;box-shadow:0 14px 45px rgba(0,0,0,.48);font:14px/1.4 Arial,sans-serif}' +
      '.title{font-weight:800;color:#c9b8ff;margin-bottom:5px}.msg{color:#eee}.row{display:flex;gap:9px;align-items:center;margin-top:11px;flex-wrap:wrap}' +
      'button{border:0;border-radius:9px;padding:9px 13px;font-weight:800;cursor:pointer;background:#7c5cff;color:white}button.secondary{background:#302840;color:#ddd}' +
      '.error{color:#ff9c9c;margin-top:7px}.spin{display:inline-block;width:11px;height:11px;border:2px solid #796d8f;border-top-color:#fff;border-radius:50%;animation:s .7s linear infinite;margin-right:7px}@keyframes s{to{transform:rotate(360deg)}}' +
      '</style><div class="box"><div class="title"></div><div class="msg"></div><div class="error"></div><div class="row"></div></div>';
    (document.documentElement || document.body).appendChild(host);
    return shadow;
  }

  function render(mode, error) {
    const root = ensureUi();
    const title = root.querySelector('.title');
    const msg = root.querySelector('.msg');
    const row = root.querySelector('.row');
    const errorEl = root.querySelector('.error');
    row.innerHTML = '';
    errorEl.textContent = error || '';

    if (mode === 'pausing') {
      title.textContent = 'IAmax detecto la verificacion de Lovable';
      msg.innerHTML = '<span class="spin"></span>Pausando Usagi temporalmente y recargando...';
      return;
    }

    if (mode === 'paused') {
      title.textContent = 'Usagi pausada temporalmente';
      msg.textContent = 'Envia otra vez el prompt y completa el CAPTCHA de Lovable. Cuando termine, reactiva Usagi.';
      const resume = document.createElement('button');
      resume.textContent = 'Ya complete el CAPTCHA - Reactivar Usagi';
      resume.addEventListener('click', async function () {
        resume.disabled = true;
        resume.textContent = 'Reactivando...';
        const result = await send('IAMAX_CAPTCHA_RECOVERY_RESUME');
        if (!result.ok) {
          resume.disabled = false;
          resume.textContent = 'Reintentar reactivacion';
          errorEl.textContent = result.error || 'No se pudo reactivar Usagi';
          return;
        }
        location.reload();
      });
      row.appendChild(resume);
      return;
    }

    title.textContent = 'Lovable solicito verificacion humana';
    msg.textContent = 'IAmax aplicara el procedimiento recomendado por Usagi sin salir del modo incognito.';
  }

  async function beginRecovery() {
    if (recoveryStarted || paused) return;
    recoveryStarted = true;
    render('pausing');
    const result = await send('IAMAX_CAPTCHA_RECOVERY_PAUSE');
    if (!result.ok) {
      recoveryStarted = false;
      render('detected', result.error || 'No se pudo pausar Usagi');
      return;
    }
    setTimeout(function () { location.reload(); }, 500);
  }

  function hasCaptchaError(node) {
    const text = String(node && node.textContent || '');
    return /captcha_required/i.test(text)
      || /additional verification is required/i.test(text)
      || /status[^0-9]{0,8}428/i.test(text);
  }

  async function boot() {
    const state = await send('IAMAX_CAPTCHA_RECOVERY_STATUS');
    if (state.ok && Array.isArray(state.pausedIds) && state.pausedIds.length) {
      paused = true;
      render('paused');
      return;
    }
    if (hasCaptchaError(document.body)) beginRecovery();
    const observer = new MutationObserver(function (mutations) {
      if (paused || recoveryStarted) return;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes || []) {
          if (hasCaptchaError(node)) {
            beginRecovery();
            return;
          }
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
`;

  return {
    permissions: ['management', 'storage'],
    backgroundJs,
    contentJs,
    contentScript: {
      matches: LOVABLE_MATCHES.slice(),
      js: ['captcha-recovery.js'],
      run_at: 'document_idle',
      all_frames: false
    }
  };
}

module.exports = {
  LOVABLE_MATCHES,
  buildLovableCaptchaRecovery
};
