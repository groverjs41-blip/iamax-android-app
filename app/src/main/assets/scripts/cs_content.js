/**
 * IAmax Credential Shield — SOLO login real de credenciales.
 * - No corre en dashboards / herramientas (Rocketoolz, Flow, ChatGPT, etc.)
 * - No usa MutationObserver de attributes (evita bucle y página "pegada")
 * - Overlays con pointer-events:none
 */
(function () {
  if (window.__iamaxCredentialShieldV4) return;
  window.__iamaxCredentialShieldV4 = true;

  // Google accounts: no shield (rompe layout / recarga challenge con otro TL=)
  try {
    if (/accounts\.google\./i.test(String(location.hostname || ''))) return;
  } catch (e) {}

  const overlays = new Map();
  let scheduled = false;
  let lastTick = 0;

  function host() {
    try {
      return String(location.hostname || '').toLowerCase();
    } catch (e) {
      return '';
    }
  }

  function isGoogleLoginHost() {
    return /accounts\.google\./i.test(host());
  }

  function isAppToolHost() {
    const h = host();
    return /^(?:chatgpt\.com|gemini\.google\.com|aistudio\.google\.com|notebooklm\.google\.com|grok\.com)$/.test(h)
      || /rocketoolz|lovable|canva|perplexity|qwen|scribd|syntx|quillbot/.test(h);
  }

  /** Google contraseña/2FA: no censurar ni tocar (el usuario escribe a mano). */
  function isGooglePasswordChallenge() {
    try {
      if (!isGoogleLoginHost()) return false;
      const h = String(location.href || '') + String(location.pathname || '');
      if (/challenge/i.test(h)) return true;
      const pass = document.querySelector('input[name="Passwd"]');
      const id = document.querySelector('#identifierId, input[name="identifier"]');
      if (pass && (!id || id.offsetParent === null)) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  /** Apps ya logueadas (sin form de login): no censurar UI del producto. */
  function isLoggedInAppShell() {
    try {
      const h = host();
      const path = String(location.pathname || '').toLowerCase();
      // Google apps (no accounts.google)
      if (/^gemini\.google\.|^aistudio\.google\.|^notebooklm\.google\.|^labs\.google/i.test(h)) {
        return !isGoogleLoginHost();
      }
      // Si hay form de password visible, NO es shell logueado
      if (document.querySelector('input[type="password"]:not([disabled])')) return false;
      // Rutas de producto típicas sin login
      if (/\/(app|dashboard|home|workspace|project|chat|studio|editor)(\/|$)/i.test(path)) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  function isStrictLoginUrl() {
    try {
      const path = String(location.pathname || '').toLowerCase();
      const href = String(location.href || '').toLowerCase();

      // Google accounts = sí (login / challenge)
      if (isGoogleLoginHost()) return true;

      // Rutas claras de login (incluye Cloudflare / clerk / rocketoolz newlogin)
      if (
        /\/(login|signin|sign-in|sign_in|newlogin|wp-login\.php|accountchooser|challenge|identifier)(\/|$|\?)/i.test(path) ||
        /\/(login|signin|sign-in|newlogin)(\/|$|\?)/i.test(href)
      ) {
        return true;
      }
      if (/wp-login\.php|\/wp-admin\/?$/i.test(path + href)) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  function hasVisiblePasswordForm() {
    try {
      const pass = document.querySelector(
        'input[type="password"]:not([disabled]):not([aria-hidden="true"])'
      );
      if (!pass) return false;
      const r = pass.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  function pageIsLoginContext() {
    // Censura en CUALQUIER login visible, también con "compatibilidad Cloudflare"
    // (antes se saltaban rocketoolz/gamma/perplexity y se veía email/pass en claro).
    if (isLoggedInAppShell()) return false;
    // Google pass: manos fuera (si no, el campo “se cambia” y no se puede escribir)
    if (isGooglePasswordChallenge()) return false;
    return isStrictLoginUrl() || hasVisiblePasswordForm() || isGoogleLoginHost();
  }

  function bullets(n) {
    const len = Math.max(10, Math.min(28, Number(n) || 12));
    return Array(len + 1).join('\u2022');
  }

  function meta(el) {
    return [el.name, el.id, el.type, el.autocomplete, el.placeholder, el.getAttribute('aria-label')]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  }

  function isPass(el) {
    if (!el) return false;
    if (el.type === 'password') return true;
    const m = meta(el);
    return /^(pwd|password|passwd|pass)$/i.test(el.name || '') || /current-password|new-password|contrase/.test(m);
  }

  function isEmail(el) {
    if (!el || isPass(el)) return false;
    const m = meta(el);
    return (
      el.type === 'email' ||
      /^(log|login|user|username|email|identifier)$/i.test(el.name || '') ||
      /user_login|identifierid/.test(el.id || '') ||
      /autocomplete="username"|autocomplete="email"/.test(m) ||
      (el.name === 'log' && el.type !== 'hidden')
    );
  }

  function isTotp(el) {
    if (!el) return false;
    const m = meta(el);
    return (
      el.autocomplete === 'one-time-code' ||
      /totp|otp|one-time|2fa|idv|pin/.test(m)
    );
  }

  function shouldMask(el) {
    if (!pageIsLoginContext()) return false;
    if (!el || el.tagName !== 'INPUT') return false;
    if (
      el.disabled ||
      el.readOnly ||
      el.type === 'hidden' ||
      el.type === 'checkbox' ||
      el.type === 'radio' ||
      el.type === 'submit' ||
      el.type === 'button' ||
      el.type === 'file' ||
      el.type === 'search' ||
      el.type === 'range' ||
      el.type === 'color'
    ) {
      return false;
    }
    const v = String(el.value || '');
    if (!v) return false;
    if (isPass(el) && v.length >= 1) return true;
    if (isEmail(el) && v.length >= 2) return true;
    if (isTotp(el) && v.length >= 4 && v.length <= 12) return true;
    if ((el.name === 'log' || el.id === 'user_login') && v.length >= 2) return true;
    return false;
  }

  function hidePasswordEyes() {
    if (!pageIsLoginContext()) return;
    try {
      document.querySelectorAll('button[aria-label], [role="button"][aria-label], button[title]').forEach((el) => {
        try {
          const t = [el.getAttribute('aria-label'), el.getAttribute('title')]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          // SOLO toggles de "mostrar contraseña" (nunca botones genéricos de la app)
          if (!/show password|hide password|toggle.?password|password.?visibility|mostrar contrase|ver contrase|ocultar contrase|mostrar la contrase/.test(t)) {
            return;
          }
          el.style.setProperty('visibility', 'hidden', 'important');
          el.style.setProperty('pointer-events', 'none', 'important');
          el.setAttribute('data-iamax-hide-eye', '1');
        } catch (e) {}
      });
    } catch (e) {}
  }

  function forceMaskStyle(el) {
    try {
      // Solo puntitos nativos — sin fondo blanco / overlay
      el.style.setProperty('-webkit-text-security', 'disc', 'important');
      el.style.setProperty('color', '#e8eaed', 'important');
      el.style.setProperty('-webkit-text-fill-color', '#e8eaed', 'important');
      el.style.setProperty('caret-color', 'transparent', 'important');
      el.style.setProperty('background', 'transparent', 'important');
      el.style.setProperty('background-color', 'transparent', 'important');
      el.style.setProperty('box-shadow', 'none', 'important');
      if (el.getAttribute('data-iamax-secured') !== '1') {
        el.setAttribute('data-iamax-secured', '1');
      }
    } catch (e) {}
  }

  function paint(el) {
    // No dibujar overlay (el default #f8fafc se veía blanco). Bastan los discos.
    try {
      forceMaskStyle(el);
      const ex = overlays.get(el);
      if (ex) {
        try { ex.remove(); } catch (e) {}
        overlays.delete(el);
      }
      document.querySelectorAll('.iamax-cred-mask').forEach((n) => {
        try { n.remove(); } catch (e) {}
      });
    } catch (e) {}
  }

  function clearAllOverlays() {
    try {
      overlays.forEach((div) => {
        try {
          div.remove();
        } catch (e) {}
      });
      overlays.clear();
      document.querySelectorAll('.iamax-cred-mask').forEach((n) => {
        try {
          n.remove();
        } catch (e) {}
      });
    } catch (e) {}
  }

  function tick() {
    const now = Date.now();
    if (now - lastTick < 180) return;
    lastTick = now;
    try {
      if (!pageIsLoginContext()) {
        clearAllOverlays();
        return;
      }
      hidePasswordEyes();
      document.querySelectorAll('input').forEach((el) => {
        if (!shouldMask(el)) {
          const d = overlays.get(el);
          if (d) d.style.display = 'none';
          return;
        }
        forceMaskStyle(el);
        paint(el);
      });
    } catch (e) {}
  }

  function scheduleTick() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      tick();
    });
  }

  // Apps: no instalar observers ni intervalos (cero impacto)
  if (isAppToolHost() && !isGoogleLoginHost()) {
    return;
  }

  setInterval(tick, 500);
  window.addEventListener('scroll', scheduleTick, { passive: true, capture: true });
  window.addEventListener('resize', scheduleTick, { passive: true });

  // SOLO childList — attributes:true causaba bucle infinito (freeze total)
  try {
    new MutationObserver((mutations) => {
      if (!pageIsLoginContext()) return;
      for (const m of mutations) {
        if (m.type === 'childList') {
          scheduleTick();
          return;
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}

  tick();
})();
