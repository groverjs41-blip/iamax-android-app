/**
 * Máscara visual de credenciales en pantallas de LOGIN.
 * - Puntitos con -webkit-text-security (sin overlays fijos → no bloquea clics)
 * - Fuerza type=password y oculta el ojo "mostrar"
 * - En dashboards ya logueados NO actúa (evita páginas pegadas)
 */
(function () {
  // Google accounts: NUNCA máscara/CSS (rompe layout y recarga challenge/pwd con otro TL=)
  try {
    if (/accounts\.google\./i.test(String(location.hostname || ''))) {
      window.__iamaxMaskEngineInstalled = true;
      window.__iamaxMaskTick = function () {};
      return;
    }
  } catch (e) {}

  if (window.__iamaxMaskEngineInstalled) {
    if (typeof window.__iamaxMaskTick === 'function') window.__iamaxMaskTick();
    return;
  }
  window.__iamaxMaskEngineInstalled = true;
  window.__iamaxInjectedCreds = window.__iamaxInjectedCreds || { email: '', password: '', totp: '' };
  window.__iamaxSetInjectedCreds = function (email, password, totp) {
    window.__iamaxInjectedCreds = {
      email: String(email || ''),
      password: String(password || ''),
      totp: String(totp || '')
    };
  };

  function isGoogleAccounts() {
    try {
      return /accounts\.google\./i.test(String(location.hostname || ''));
    } catch (e) {
      return false;
    }
  }

  /** Google contraseña/2FA: NO tocar el campo (el usuario escribe a mano). */
  function isGooglePasswordChallenge() {
    try {
      if (!isGoogleAccounts()) return false;
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

  /** Apps de Google ya logueadas: NUNCA enmascarar (rompe UI de Gemini/AI Studio/etc.). */
  function isGoogleAppShell() {
    try {
      const h = String(location.hostname || '').toLowerCase();
      if (/^gemini\.google\.|^aistudio\.google\.|^notebooklm\.google\.|^labs\.google/i.test(h)) return true;
      if (/google\./i.test(h) && /\/app(\/|$)/i.test(location.pathname || '')) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  /** true solo en formulario de login visible (incluye Rocketoolz/Treblo /newlogin). */
  function isLogin() {
    try {
      if (isGoogleAppShell()) return false;
      // NUNCA enmascarar en Google pass: impide escribir y “cambia” el campo
      if (isGooglePasswordChallenge()) return false;
      const h = String(location.hostname || '').toLowerCase();
      const u = String(location.href || '').toLowerCase();
      const path = String(location.pathname || '').toLowerCase();
      // Solo login de cuentas Google, no gemini.google.com/app
      if (isGoogleAccounts()) return true;
      if (/\/(login|signin|sign-in|newlogin|wp-login|auth|account)(\/|$|\?)/i.test(path + u)) {
        return hasVisibleCredentialForm();
      }
      // Herramientas: solo si hay form de password a la vista (no dashboard)
      return hasVisibleCredentialForm();
    } catch (e) {
      return false;
    }
  }

  function hasVisibleCredentialForm() {
    try {
      const pass = document.querySelector(
        'input[type="password"]:not([disabled]), input[name="pwd"]:not([disabled]), input[name="password"]:not([disabled])'
      );
      if (!pass) return false;
      const r = pass.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return false;
      // Email/user cerca del password
      const root = pass.form || pass.closest('form, main, section, div') || document;
      const user = root.querySelector(
        'input[type="email"], input[type="text"], input[name="log"], input[name="email"], input#user_login, input[autocomplete="username"]'
      );
      return Boolean(user || pass);
    } catch (e) {
      return false;
    }
  }

  function ensureMaskStyleSheet() {
    try {
      // v3: puntos blancos sobre casilla negra de Google (Material dark)
      let st = document.getElementById('iamax-mask-dots-white-v3');
      if (!st) {
        st = document.createElement('style');
        st.id = 'iamax-mask-dots-white-v3';
        (document.head || document.documentElement).appendChild(st);
      }
      const lightHost = (() => {
        try {
          const h = String(location.hostname || '').toLowerCase();
          if (/accounts\.google\./i.test(h)) return false;
          return true;
        } catch (e) { return true; }
      })();
      const ink = lightHost ? '#111827' : '#ffffff';
      st.textContent = [
        /* Email + password: disc (oscuro en Rocketoolz/claro, blanco en Google) */
        'input[data-iamax-secured="1"],',
        'input[data-iamax-secured="1"][type="password"],',
        'input[data-iamax-secured="1"][type="email"],',
        'input[data-iamax-secured="1"][type="text"],',
        'input[data-iamax-secured="1"]#identifierId,',
        'input[data-iamax-secured="1"][name="identifier"],',
        'input[data-iamax-secured="1"][name="Passwd"]{',
        '-webkit-text-security:disc!important;',
        'text-security:disc!important;',
        `color:${ink}!important;`,
        `-webkit-text-fill-color:${ink}!important;`,
        `caret-color:${ink}!important;`,
        'letter-spacing:0.2em!important;',
        'opacity:1!important;',
        'filter:none!important;',
        'text-shadow:none!important;',
        '}',
        'input[data-iamax-secured="1"]:focus,',
        'input[data-iamax-secured="1"]:focus-visible,',
        'input[data-iamax-secured="1"]:hover{',
        `color:${ink}!important;`,
        `-webkit-text-fill-color:${ink}!important;`,
        `caret-color:${ink}!important;`,
        'box-shadow:none!important;',
        'outline:none!important;',
        '}',
        /* Google Material: forzar encima de sus variables */
        '.whsOnd[data-iamax-secured="1"],',
        '.zHQkBf[data-iamax-secured="1"],',
        'input.whsOnd[data-iamax-secured="1"]{',
        'color:#ffffff!important;-webkit-text-fill-color:#ffffff!important;',
        '-webkit-text-security:disc!important;',
        '}',
        '.iamax-mask-overlay,.iamax-cred-mask{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important;}'
      ].join('');
      try {
        ['iamax-mask-no-white', 'iamax-mask-dots-white'].forEach(function (id) {
          const old = document.getElementById(id);
          if (old) old.remove();
        });
      } catch (e) {}
    } catch (e) {}
  }

  function applyWhiteDots(el) {
    if (!el) return;
    try {
      el.style.setProperty('-webkit-text-security', 'disc', 'important');
      el.style.setProperty('text-security', 'disc', 'important');
      el.style.setProperty('color', '#ffffff', 'important');
      el.style.setProperty('-webkit-text-fill-color', '#ffffff', 'important');
      el.style.setProperty('caret-color', '#ffffff', 'important');
      el.style.setProperty('letter-spacing', '0.18em', 'important');
      el.style.setProperty('opacity', '1', 'important');
      el.style.setProperty('filter', 'none', 'important');
      el.style.setProperty('text-shadow', 'none', 'important');
    } catch (e) {}
  }

  function maskInput(el, asPassword) {
    if (!el || !el.value) return;
    try {
      ensureMaskStyleSheet();
      const val = String(el.value || '');
      // Reaplicar color blanco siempre (Google pisa estilos al focus)
      if (el.getAttribute('data-iamax-secured') === '1' && el.__iamaxMaskVal === val) {
        applyWhiteDots(el);
        return;
      }
      el.__iamaxMaskVal = val;

      const isNativePassword = String(el.type || '').toLowerCase() === 'password'
        || asPassword
        || /password|passwd|pwd/i.test(String(el.name || '') + String(el.id || '') + String(el.autocomplete || ''));

      if (isNativePassword) {
        try {
          if (el.type !== 'password') {
            el.type = 'password';
            el.setAttribute('type', 'password');
          }
        } catch (e) {}
      }
      // Email y password: disc blancos (fondo Google negro)
      applyWhiteDots(el);
      el.style.setProperty('background', 'transparent', 'important');
      el.style.setProperty('background-color', 'transparent', 'important');
      el.style.setProperty('box-shadow', 'none', 'important');
      el.setAttribute('data-iamax-secured', '1');
      el.setAttribute('spellcheck', 'false');
      try { el.setAttribute('autocomplete', 'off'); } catch (e) {}
      if (!el.__iamaxCopyBlocked) {
        el.__iamaxCopyBlocked = true;
        const block = function (ev) {
          try {
            ev.preventDefault();
            ev.stopImmediatePropagation();
          } catch (e) {}
        };
        ['copy', 'cut', 'contextmenu', 'selectstart', 'dragstart'].forEach(function (evName) {
          el.addEventListener(evName, block, true);
        });
      }
    } catch (e) {}
  }

  function hideShowPasswordToggles() {
    try {
      document.querySelectorAll('button, [role="button"], a, span').forEach(function (el) {
        try {
          const aria = String(el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase();
          const cls = String(el.className || '').toLowerCase();
          const looksEye =
            /show password|hide password|toggle password|password visibility|mostrar contrase|ocultar contrase|ver contrase|show pass|hide pass/.test(aria)
            || /dashicons-visibility|dashicons-hidden|password-toggle|toggle-password|show-password/.test(cls);
          // Icono ojo al lado del password (Rocketoolz WP)
          if (!looksEye) {
            const nearPass = el.closest('.password-input, .wp-pwd, .login-password, .input-group, label, div');
            if (nearPass && nearPass.querySelector('input[type="password"], input[name="pwd"], input[name="password"]')) {
              if (/eye|visibility|show|hide|toggle/.test(cls + ' ' + aria) || el.querySelector('svg, i, .dashicons')) {
                // solo si es botón pequeño junto al pass
                const r = el.getBoundingClientRect();
                if (r.width > 0 && r.width < 56 && r.height < 56) {
                  el.setAttribute('data-iamax-hide-eye', '1');
                  el.style.setProperty('visibility', 'hidden', 'important');
                  el.style.setProperty('pointer-events', 'none', 'important');
                  el.style.setProperty('opacity', '0', 'important');
                  return;
                }
              }
            }
          }
          if (!looksEye) return;
          el.setAttribute('data-iamax-hide-eye', '1');
          el.style.setProperty('visibility', 'hidden', 'important');
          el.style.setProperty('pointer-events', 'none', 'important');
          el.style.setProperty('opacity', '0', 'important');
        } catch (e) {}
      });
      // Checkbox "mostrar contraseña"
      document.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
        const label = [
          cb.getAttribute('aria-label'),
          cb.parentElement && cb.parentElement.textContent,
          cb.closest('label') && cb.closest('label').textContent
        ].filter(Boolean).join(' ').toLowerCase();
        if (/mostrar|show password|ver contrase|visible/.test(label) && cb.checked) {
          try { cb.click(); } catch (e) {
            try { cb.checked = false; } catch (e2) {}
          }
        }
      });
    } catch (e) {}
  }

  function removeHeavyOverlays() {
    try {
      document.querySelectorAll('.iamax-mask-overlay, .iamax-cred-mask').forEach(function (n) {
        try { n.remove(); } catch (e) {}
      });
    } catch (e) {}
  }

  function tick() {
    removeHeavyOverlays();
    // Gemini / apps: salir YA (no blur ni puntos en el chat)
    if (isGoogleAppShell()) return;
    if (!isLogin()) return;
    try {
      const creds = window.__iamaxInjectedCreds || {};
      const email = String(creds.email || '');
      const password = String(creds.password || '');

      // Password nativo: solo marcar una vez (sin text-security)
      document.querySelectorAll(
        'input[type="password"], input[name="pwd"], input[name="password"], input[name="Passwd"], input[autocomplete="current-password"], input[data-iamax-field="password"]'
      ).forEach(function (el) {
        if (!el.value) return;
        maskInput(el, true);
      });

      // Email / username
      document.querySelectorAll(
        'input[type="email"], input[name="email"], input[name="log"], input[name="identifier"], input#identifierId, input#user_login, input[autocomplete="username"], input[autocomplete="email"], input[data-iamax-field="email"]'
      ).forEach(function (el) {
        if (!el.value) return;
        if (email && String(el.value) === email) maskInput(el, false);
        else if (isLogin() && el.type !== 'password') maskInput(el, false);
      });

      // Chip de cuenta Google: blur una sola vez
      if (isGoogleAccounts()) {
        document.querySelectorAll('[data-email], [data-identifier]').forEach(function (el) {
          try {
            if (el.getAttribute('data-iamax-secured') === '1') return;
            const id = String(el.getAttribute('data-email') || el.getAttribute('data-identifier') || '').trim();
            if (!id || !id.includes('@')) return;
            el.style.setProperty('filter', 'blur(4px)', 'important');
            el.setAttribute('data-iamax-secured', '1');
          } catch (e) {}
        });
      }

      if (email || password) {
        document.querySelectorAll('input').forEach(function (el) {
          if (!el.value || el.type === 'hidden') return;
          if (el.getAttribute('data-iamax-secured') === '1' && el.__iamaxMaskVal === String(el.value)) return;
          const v = String(el.value);
          if (password && v === password) maskInput(el, true);
          else if (email && v === email) maskInput(el, false);
        });
      }

      hideShowPasswordToggles();
    } catch (e) {}
  }

  window.__iamaxMaskTick = tick;
  window.__iamaxApplyCredMask = tick;

  tick();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tick, { once: true });
  }
  // Intervalo más largo = menos parpadeo; re-mask solo si Google re-renderiza el input
  if (!window.__iamaxMaskInterval) {
    window.__iamaxMaskInterval = setInterval(tick, 2500);
  }
  setTimeout(tick, 400);
  setTimeout(tick, 1500);
})();
