window.runIamaxInjection = function(email, password, totpCode) {
    console.log(
      "[IAMAX-INJECT] Script inyectado en:",
      String(window.location.origin || '') + String(window.location.pathname || ''),
      "emailLen=",
      String(email || '').length
    );

    const isGoogle = /accounts\.google\./i.test(String(location.hostname || ''));
    const isQwenHost = /(^|\.)qwen\.ai$|(^|\.)alibabacloud\.com$/i.test(String(location.hostname || ''));
    const qwenSensitiveKeys = /^(email|password|pass|passwd|pwd)$/i;

    // Qwen puede degradar su formulario React a un GET nativo cuando su runtime
    // falla o todavía no terminó de cargar. Eso expone credenciales en la URL y
    // provoca un ciclo /auth -> recarga -> /auth. Limpiamos el historial sin
    // navegar y bloqueamos exclusivamente ese fallback GET.
    const sanitizeQwenUrl = () => {
      if (!isQwenHost) return false;
      try {
        const current = new URL(window.location.href);
        let dirty = false;
        Array.from(current.searchParams.keys()).forEach((key) => {
          if (qwenSensitiveKeys.test(String(key || ''))) {
            current.searchParams.delete(key);
            dirty = true;
          }
        });
        if (dirty) {
          const safeRelativeUrl = current.pathname + current.search + current.hash;
          window.history.replaceState(window.history.state, document.title, safeRelativeUrl);
        }
        return dirty;
      } catch (e) {
        return false;
      }
    };

    const installQwenNavigationGuard = () => {
      if (!isQwenHost || window.__iamaxQwenNavigationGuard) return;
      window.__iamaxQwenNavigationGuard = true;

      document.addEventListener('submit', (event) => {
        try {
          const form = event.target;
          if (!form || String(form.tagName || '').toUpperCase() !== 'FORM') return;
          const method = String(form.getAttribute('method') || 'get').toLowerCase();
          const hasCredentials = Boolean(form.querySelector(
            'input[type="password"], input[name="email" i], input[name*="password" i], input[autocomplete="username"], input[autocomplete="current-password"]'
          ));
          if (method === 'get' && hasCredentials) {
            // No detenemos la propagación: el onSubmit de React aún puede
            // autenticar por API. Solo anulamos la navegación GET insegura.
            event.preventDefault();
            setTimeout(sanitizeQwenUrl, 0);
          }
        } catch (e) {}
      }, true);

      window.addEventListener('popstate', sanitizeQwenUrl);
      setTimeout(sanitizeQwenUrl, 0);
      setTimeout(sanitizeQwenUrl, 500);
    };

    if (isQwenHost) {
      sanitizeQwenUrl();
      installQwenNavigationGuard();
    }
    const hrefAll = String(location.href || '') + String(location.pathname || '');
    // Pasos Google: no re-clickear chip de email en contraseña (bug "se regresa")
    const googleChallenge = isGoogle && /\/signin\/challenge|\/challenge\/pwd|\/challenge\/totp|\/challenge\/ipp|\/challenge\/selection|\/signin\/oauth|\/oauth\/consent/i.test(hrefAll);
    const googleIdentifier = isGoogle && /\/signin\/identifier/i.test(hrefAll) && !googleChallenge;
    const googleChooser = isGoogle && /accountchooser|AccountChooser|signin\/accountchooser/i.test(hrefAll);

    // Solo la cuenta asignada: saltar "Elige una cuenta" (NUNCA en challenge/pwd)
    try {
      if (email && googleChooser) {
        const want = String(email).toLowerCase();
        const nodes = document.querySelectorAll('[data-email], [data-identifier]');
        let clicked = false;
        nodes.forEach((el) => {
          const id = String(el.getAttribute('data-email') || el.getAttribute('data-identifier') || '').toLowerCase();
          if (!clicked && id && (id === want || id.includes(want) || want.includes(id))) {
            try { el.click(); clicked = true; } catch (e) {}
          } else if (id && id !== want) {
            const row = el.closest('li, div[role="link"], div[data-authuser]');
            if (row) try { row.style.display = 'none'; } catch (e) {}
          }
        });
        if (!clicked) {
          const other = [...document.querySelectorAll('div, li, button, a, span')].find((el) =>
            /usar otra cuenta|use another account|otra cuenta|another account/i.test(String(el.textContent || ''))
          );
          if (other) try { other.click(); } catch (e) {}
        }
      }
    } catch (e) {}

    function querySelectorAllDeep(selector, root = document) {
        let results = [];
        try { results = Array.from(root.querySelectorAll(selector)); } catch (e) { results = []; }
        const allElements = root.querySelectorAll('*');
        for (const el of allElements) {
            if (el.shadowRoot) {
                results = results.concat(querySelectorAllDeep(selector, el.shadowRoot));
            }
        }
        return results;
    }

    function isVisible(el) {
        if (!el) return false;
        if (el.type === 'hidden' || el.disabled) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 2 && r.height < 2) return false;
        try {
            const st = window.getComputedStyle(el);
            if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
        } catch (e) {}
        return true;
    }

    /**
     * Rellena inputs controlados (React/Vue/Angular) de forma fiable.
     * Devuelve true si el valor quedó en el DOM.
     */
    const setNativeValue = (element, value) => {
      if (!element) return false;
      const str = value == null ? '' : String(value);
      try {
        const previousValue = String(element.value || '');
        element.focus();
        try { element.click(); } catch (e) {}

        // React 16+ value tracker: vaciar primero
        try {
          const tracker = element._valueTracker;
          if (tracker && typeof tracker.setValue === 'function') tracker.setValue('');
        } catch (e) {}

        const proto = window.HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) {
          desc.set.call(element, '');
          desc.set.call(element, str);
        } else {
          element.value = '';
          element.value = str;
        }

        try {
          const tracker2 = element._valueTracker;
          if (tracker2 && typeof tracker2.setValue === 'function') {
            // Qwen necesita que React observe una diferencia entre su tracker y el DOM.
            tracker2.setValue(isQwenHost ? previousValue : str);
          }
        } catch (e) {}

        try {
          element.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            composed: true,
            inputType: 'insertText',
            data: str
          }));
        } catch (e) {
          element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        }
        element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        try {
          element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
        } catch (e) {}

        // Fallback: si React lo borró, forzar atributo value
        if (String(element.value || '') !== str) {
          try { element.setAttribute('value', str); } catch (e) {}
          element.value = str;
          element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        }
        return String(element.value || '') === str;
      } catch (e) {
        console.error("[IAMAX-INJECT] setNativeValue:", e);
        try { element.value = str; } catch (e2) {}
        return String(element.value || '') === str;
      }
    };

    /**
     * CENSURA 100%: tapa el input con un overlay opaco de puntitos.
     * El valor real sigue en el input (login funciona), pero NUNCA se ve el texto.
     * El ojo "mostrar contraseña" se oculta y type=password se fuerza en loop.
     */
    const ensureCensorStyle = () => {
      try {
        let st = document.getElementById('iamax-censor-style');
        if (!st) {
          st = document.createElement('style');
          st.id = 'iamax-censor-style';
          (document.head || document.documentElement).appendChild(st);
        }
        // Solo puntos; sin fondo blanco del focus de Google
        st.textContent = `
          input[data-iamax-secured="1"],
          input[data-iamax-secured="1"][type="password"],
          input[data-iamax-secured="1"][type="email"],
          input[data-iamax-secured="1"]#identifierId,
          input[data-iamax-secured="1"][name="identifier"],
          input[data-iamax-secured="1"][name="Passwd"] {
            -webkit-text-security: disc !important;
            text-security: disc !important;
            color: #ffffff !important;
            -webkit-text-fill-color: #ffffff !important;
            caret-color: #ffffff !important;
            text-shadow: none !important;
            filter: none !important;
            opacity: 1 !important;
            user-select: none !important;
            -webkit-user-select: none !important;
            letter-spacing: 0.18em !important;
            background: transparent !important;
            background-color: transparent !important;
            box-shadow: none !important;
            outline: none !important;
          }
          input[data-iamax-secured="1"]:focus,
          input[data-iamax-secured="1"]:focus-visible {
            color: #ffffff !important;
            -webkit-text-fill-color: #ffffff !important;
            caret-color: #ffffff !important;
            background: transparent !important;
            box-shadow: none !important;
            outline: none !important;
          }
          input.whsOnd[data-iamax-secured="1"] {
            color: #ffffff !important;
            -webkit-text-fill-color: #ffffff !important;
            -webkit-text-security: disc !important;
          }
          .iamax-mask-wrap {
            position: relative !important;
            display: block !important;
          }
          .iamax-mask-overlay,
          .iamax-cred-mask {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            pointer-events: none !important;
          }
          .iamax-mask-overlay-disabled {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            display: none !important;
            align-items: center !important;
            padding: 0 14px !important;
            box-sizing: border-box !important;
            pointer-events: none !important;
            z-index: 2147483000 !important;
            color: #c5c9d1 !important;
            font-size: 16px !important;
            font-family: system-ui, Segoe UI, sans-serif !important;
            letter-spacing: 3px !important;
            background: #1a1d24 !important;
            border-radius: 8px !important;
            overflow: hidden !important;
            white-space: nowrap !important;
          }
          [data-iamax-hide-eye="1"] {
            display: none !important;
            visibility: hidden !important;
            pointer-events: none !important;
            opacity: 0 !important;
            width: 0 !important;
            height: 0 !important;
            overflow: hidden !important;
          }
        `;
      } catch (e) {}
    };

    const bulletsFor = (val) => {
      const n = Math.max(8, Math.min(28, String(val || '').length || 10));
      return '•'.repeat(n);
    };

    /**
     * Overlay FIXED al viewport: cubre el input al 100% aunque el sitio
     * use flex/grid/overflow y mate position:absolute del padre.
     */
    const placeOverlay = (input) => {
      try {
        if (!input || !document.body) return;
        if (!input.dataset.iamaxMaskId) {
          input.dataset.iamaxMaskId = 'm' + Math.random().toString(36).slice(2, 9);
        }
        const id = input.dataset.iamaxMaskId;
        let overlay = document.getElementById('iamax-mask-' + id);
        if (!overlay) {
          overlay = document.createElement('div');
          overlay.id = 'iamax-mask-' + id;
          overlay.className = 'iamax-mask-overlay';
          overlay.dataset.for = id;
          document.body.appendChild(overlay);
        }
        const r = input.getBoundingClientRect();
        if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > window.innerHeight) {
          overlay.style.display = 'none';
          return;
        }
        // Fondo opaco = no se lee el texto debajo
        let bg = '#eef0f4';
        try {
          const cs = window.getComputedStyle(input);
          if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') {
            bg = cs.backgroundColor;
          } else {
            bg = '#f3f4f6';
          }
        } catch (e) {}
        Object.assign(overlay.style, {
          position: 'fixed',
          left: r.left + 'px',
          top: r.top + 'px',
          width: r.width + 'px',
          height: r.height + 'px',
          display: 'flex',
          alignItems: 'center',
          paddingLeft: '14px',
          boxSizing: 'border-box',
          pointerEvents: 'none',
          zIndex: '2147483645',
          color: '#6b7280',
          fontSize: '18px',
          fontFamily: 'system-ui,Segoe UI,sans-serif',
          letterSpacing: '4px',
          background: bg,
          borderRadius: '10px',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          border: '1px solid rgba(0,0,0,0.06)',
          margin: '0',
          right: 'auto',
          bottom: 'auto'
        });
        overlay.textContent = bulletsFor(input.value);
      } catch (e) {}
    };

    const censorCredentialField = (i, isPass) => {
        if (!i) return;
        ensureCensorStyle();
        try {
          const val = String(i.value || '');
          if (i.getAttribute('data-iamax-secured') === '1' && i.__iamaxMaskVal === val) return;
          i.__iamaxMaskVal = val;
          if (isPass) {
            try {
              i.type = 'password';
              i.setAttribute('type', 'password');
            } catch (e) {}
            // Password + email: disc BLANCOS (fondo Google negro)
            i.style.setProperty('-webkit-text-security', 'disc', 'important');
            i.style.setProperty('text-security', 'disc', 'important');
            i.style.setProperty('color', '#ffffff', 'important');
            i.style.setProperty('-webkit-text-fill-color', '#ffffff', 'important');
            i.style.setProperty('caret-color', '#ffffff', 'important');
            i.style.setProperty('letter-spacing', '0.18em', 'important');
            i.style.setProperty('opacity', '1', 'important');
            i.style.setProperty('filter', 'none', 'important');
          } else {
            i.style.setProperty('-webkit-text-security', 'disc', 'important');
            i.style.setProperty('text-security', 'disc', 'important');
            i.style.setProperty('color', '#ffffff', 'important');
            i.style.setProperty('-webkit-text-fill-color', '#ffffff', 'important');
            i.style.setProperty('caret-color', '#ffffff', 'important');
            i.style.setProperty('letter-spacing', '0.18em', 'important');
            i.style.setProperty('opacity', '1', 'important');
            i.style.setProperty('filter', 'none', 'important');
          }
          i.style.setProperty('user-select', 'none', 'important');
          i.setAttribute('data-iamax-secured', '1');
          i.setAttribute('spellcheck', 'false');
          try { i.setAttribute('autocomplete', 'off'); } catch (e) {}

          // NUNCA overlay fijo en SPA de login (Qwen/Treblo/Rocketoolz):
          // tapa el botón Sign in y deja el form “roto” (icono rojo / disabled).
          // Solo disc CSS. placeOverlay solo en Google si hiciera falta (y ahí tampoco).
          try {
            document.querySelectorAll('.iamax-mask-overlay').forEach((n) => n.remove());
          } catch (e) {}

          if (!i.__iamaxCopyBlocked) {
            i.__iamaxCopyBlocked = true;
            const block = (ev) => { try { ev.preventDefault(); ev.stopImmediatePropagation(); } catch (e) {} };
            ['copy', 'cut', 'contextmenu', 'selectstart', 'dragstart'].forEach((evName) => {
              i.addEventListener(evName, block, true);
            });
            if (isPass) {
              const lockType = () => {
                try {
                  if (i.type !== 'password') {
                    i.type = 'password';
                    i.setAttribute('type', 'password');
                  }
                  placeOverlay(i);
                } catch (e) {}
              };
              i.addEventListener('input', lockType, true);
              i.addEventListener('focus', lockType, true);
              i.addEventListener('blur', lockType, true);
              i.addEventListener('click', lockType, true);
              try {
                new MutationObserver(lockType).observe(i, { attributes: true, attributeFilter: ['type', 'class', 'style', 'value'] });
              } catch (e) {}
            }
          }
        } catch (e) {}
    };

    const hideShowPasswordToggles = () => {
        try {
          // SOLO toggles claros de "mostrar contraseña" (nunca botones genéricos de la app)
          document.querySelectorAll('button[aria-label], [role="button"][aria-label], button[title]').forEach((el) => {
            try {
              if (el.classList && el.classList.contains('iamax-mask-overlay')) return;
              const aria = String(el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase();
              const looksEye = /show password|hide password|toggle password|password visibility|mostrar contrase|ocultar contrase|ver contrase|mostrar la contrase/.test(aria);
              if (!looksEye) return;
              el.setAttribute('data-iamax-hide-eye', '1');
              el.style.setProperty('visibility', 'hidden', 'important');
              el.style.setProperty('pointer-events', 'none', 'important');
            } catch (e) {}
          });
        } catch (e) {}
    };

    const resecureAll = () => {
        try {
          ensureCensorStyle();
          document.querySelectorAll(
            'input[data-iamax-secured="1"], input[data-iamax-field="email"], input[data-iamax-field="password"], input[data-iamax-field="totp"]'
          ).forEach((el) => {
            const isPass = el.getAttribute('data-iamax-field') === 'password'
              || /pass|pwd|passwd/i.test(String(el.name || '') + String(el.id || ''));
            if (isPass) {
              try { el.type = 'password'; el.setAttribute('type', 'password'); } catch (e) {}
            }
            censorCredentialField(el, isPass);
          });
          hideShowPasswordToggles();
        } catch (e) {}
    };

    const uncheckShowPassword = () => {
        try {
            document.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
                const label = [
                    cb.getAttribute('aria-label'),
                    cb.parentElement?.textContent,
                    cb.closest('label')?.textContent
                ].filter(Boolean).join(' ').toLowerCase();
                if (/mostrar|show password|ver contrase|visible/.test(label) && cb.checked) {
                    try { cb.click(); } catch (e) {
                        try { cb.checked = false; } catch (e2) {}
                    }
                }
            });
            hideShowPasswordToggles();
            document.querySelectorAll(
              'input[data-iamax-field="password"], input[name="pwd"], input#user_pass, input[name="password"], input[name="Passwd"], input[type="password"]'
            ).forEach((i) => {
              try { i.type = 'password'; i.setAttribute('type', 'password'); } catch (e) {}
            });
        } catch (e) {}
    };

    const injectAllFields = () => {
        let eCount = 0, pCount = 0, tCount = 0;
        let eOk = 0, pOk = 0;
        uncheckShowPassword();

        // Google multi-paso: en challenge/pwd NO tocar email (provoca regresar al identifier)
        // En identifier NO forzar password (aún no hay campo).
        const fillEmail = !googleChallenge;
        const fillPass = !googleIdentifier; // en identifier solo email; en pwd sí password
        const fillTotp = googleChallenge || !isGoogle;

        // Rocketoolz WP: name=log id=user_login | name=pwd id=user_pass
        // + genéricos username/email/password
        const emailSelectors = [
          'input#user_login',
          'input[name="log"]',
          'input[name="login"]',
          'input[name="username"]',
          'input[name="user"]',
          'input[name="email"]',
          'input[name="identifier"]',
          'input#identifierId',
          'input[type="email"]',
          'input[autocomplete="username"]',
          'input[autocomplete="email"]',
          'input[placeholder*="email" i]',
          'input[placeholder*="user" i]',
          'input[placeholder*="correo" i]',
          'input[placeholder*="Username" i]'
        ].join(', ');

        if (fillEmail) {
          const seenEmail = new Set();
          querySelectorAllDeep(emailSelectors).forEach((i) => {
              if (!isVisible(i)) return;
              if (i.type === 'password') return;
              if (seenEmail.has(i)) return;
              seenEmail.add(i);
              eCount++;
              try { i.setAttribute('data-iamax-field', 'email'); } catch (e) {}
              if (!String(i.value || '').trim() && setNativeValue(i, email)) eOk++;
              censorCredentialField(i, false);
          });

          // Fallback: primer text junto a un password en el mismo form/container
          if (eOk === 0 && email && !isGoogle) {
              querySelectorAllDeep('input[type="password"]').forEach((pass) => {
                  if (!isVisible(pass) || eOk > 0) return;
                  const root = pass.form || pass.closest('form, div, section, main') || document;
                  const candidate = root.querySelector(
                    'input[type="text"], input[type="email"], input:not([type]), input#user_login, input[name="log"]'
                  );
                  if (candidate && isVisible(candidate) && candidate !== pass) {
                      eCount++;
                      try { candidate.setAttribute('data-iamax-field', 'email'); } catch (e) {}
                      if (!String(candidate.value || '').trim() && setNativeValue(candidate, email)) eOk++;
                      censorCredentialField(candidate, false);
                  }
              });
          }
        }

        const passSelectors = [
          'input#user_pass',
          'input[name="pwd"]',
          'input[name="password"]',
          'input[name="passwd"]',
          'input[name="Passwd"]',
          'input[type="password"]',
          'input[autocomplete="current-password"]',
          'input[autocomplete="new-password"]'
        ].join(', ');

        if (fillPass) {
          const seenPass = new Set();
          querySelectorAllDeep(passSelectors).forEach((i) => {
              if (!isVisible(i)) return;
              if (i.getAttribute('data-iamax-field') === 'email') return;
              if (seenPass.has(i)) return;
              seenPass.add(i);
              pCount++;
              try { i.setAttribute('data-iamax-field', 'password'); } catch (e) {}
              // Google challenge: no rellenar pass aquí (manos fuera; usuario escribe)
              if (isGoogle && googleChallenge) {
                return;
              }
              if (!String(i.value || '') && setNativeValue(i, password)) pOk++;
              censorCredentialField(i, true);
          });
        }

        uncheckShowPassword();
        // No resecure agresivo en Google challenge (MutationObserver recarga el paso)
        if (!(isGoogle && googleChallenge)) {
          resecureAll();
        }

        if (totpCode && fillTotp) {
            const totpInputs = querySelectorAllDeep(
              'input[autocomplete="one-time-code"], input[inputmode="numeric"], input[type="tel"], ' +
              'input[name*="totp" i], input[id*="totp" i], input[name*="otp" i], input[id*="otp" i], ' +
              'input[id*="idv" i], input[name*="pin" i], input[id*="pin" i], input[aria-label*="código" i], ' +
              'input[aria-label*="codigo" i], input[aria-label*="code" i], input[placeholder*="código" i], ' +
              'input[placeholder*="codigo" i], input[placeholder*="G-" i]'
            );
            totpInputs.forEach((i) => {
                if (!isVisible(i)) return;
                if (i.getAttribute('data-iamax-field') === 'email') return;
                if (i.getAttribute('data-iamax-field') === 'password') return;
                const max = Number(i.maxLength) || 0;
                if (max > 12 && max !== -1) return;
                // No pisar tel de teléfono en paso email de Google si es largo
                const meta = [i.name, i.id, i.placeholder, i.getAttribute('aria-label')].join(' ').toLowerCase();
                if (/phone|teléfono|telefono|mobile/i.test(meta) && !/totp|otp|code|código|codigo|2fa|pin|idv/.test(meta)) return;
                tCount++;
                setNativeValue(i, totpCode);
                try { i.setAttribute('data-iamax-field', 'totp'); } catch (e) {}
                censorCredentialField(i, false);
            });
        }

        // Censurar CUALQUIER input ya rellenado con nuestros valores (clones del sitio)
        try {
          querySelectorAllDeep('input').forEach((i) => {
            if (!isVisible(i) || !i.value) return;
            const v = String(i.value);
            if (email && v === String(email)) {
              i.setAttribute('data-iamax-field', 'email');
              censorCredentialField(i, false);
            } else if (password && v === String(password)) {
              i.setAttribute('data-iamax-field', 'password');
              try { i.type = 'password'; } catch (e) {}
              censorCredentialField(i, true);
            } else if (totpCode && v.replace(/\s/g, '') === String(totpCode).replace(/\s/g, '')) {
              i.setAttribute('data-iamax-field', 'totp');
              censorCredentialField(i, false);
            }
          });
        } catch (e) {}

        const sample = querySelectorAllDeep('input').slice(0, 12).map((i) =>
          `[type=${i.type},name=${i.name},id=${i.id},ph=${(i.placeholder||'').slice(0,20)},valLen=${String(i.value||'').length}]`
        ).join(' ');
        return `e:${eCount}/${eOk} p:${pCount}/${pOk} t:${tCount} | ${sample}`;
    };

    const stopCensorLoops = () => {
      try {
        if (window.__iamaxCensorTimer) {
          clearInterval(window.__iamaxCensorTimer);
          window.__iamaxCensorTimer = null;
        }
        if (window.__iamaxCensorObserver) {
          try { window.__iamaxCensorObserver.disconnect(); } catch (e) {}
          window.__iamaxCensorObserver = null;
        }
        if (window.__iamaxInjectRetryTimer) {
          clearInterval(window.__iamaxInjectRetryTimer);
          window.__iamaxInjectRetryTimer = null;
        }
      } catch (e) {}
    };

    const firstResult = injectAllFields();
    console.log("[IAMAX-INJECT] result:", firstResult);

    /** Google multi-paso: pulsar Siguiente/Next para ir a contraseña (no dejar al usuario esperando). */
    const clickGoogleNext = () => {
      try {
        if (!isGoogle) return false;
        const labels = /siguiente|next|continuar|continue|weiter|suivant/i;
        // 1) Botones de la UI Glif
        const buttons = Array.from(document.querySelectorAll(
          'button, div[role="button"], span[role="button"], input[type="submit"]'
        ));
        const candidates = buttons.filter((b) => {
          try {
            if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
            const r = b.getBoundingClientRect();
            if (r.width < 8 || r.height < 8) return false;
            const t = String(b.textContent || b.value || b.getAttribute('aria-label') || '').trim();
            if (!labels.test(t)) return false;
            // Evitar "Crear cuenta" / "Forgot"
            if (/crear|create|forgot|olvid|help|ayuda|cuenta/i.test(t) && !labels.test(t.split(/\s+/)[0] || '')) return false;
            return true;
          } catch (e) { return false; }
        });
        // Preferir el de la derecha / primario
        const btn = candidates.find((b) => /siguiente|next/i.test(String(b.textContent || '')))
          || candidates[0];
        if (btn) {
          try { btn.disabled = false; btn.removeAttribute('disabled'); } catch (e) {}
          try { btn.click(); } catch (e) {}
          console.log('[IAMAX-INJECT] Google Next click:', String(btn.textContent || '').slice(0, 40));
          return true;
        }
        // 2) Enter en el campo activo (Google lo acepta)
        const active = document.activeElement;
        const field = document.querySelector('#identifierId, input[name="identifier"], input[name="Passwd"], input[type="password"]');
        const el = (active && active.tagName === 'INPUT') ? active : field;
        if (el) {
          try {
            el.focus();
            el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
            if (el.form) {
              try { el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit(); } catch (e) {}
            }
            return true;
          } catch (e) {}
        }
      } catch (e) {}
      return false;
    };

    // Motor de máscara FIXED (puntos) — solo un rato en login (nunca permanente)
    try {
      window.__iamaxInjectedCreds = {
        email: String(email || ''),
        password: String(password || ''),
        totp: String(totpCode || '')
      };
      if (typeof window.__iamaxSetInjectedCreds === 'function') {
        window.__iamaxSetInjectedCreds(email, password, totpCode);
      }
      if (!window.__iamaxMaskEngineInstalled && typeof window.__iamaxInstallMask !== 'function') {
        resecureAll();
      }
      if (window.__iamaxMaskTick) window.__iamaxMaskTick();
    } catch (e) {}

    // En Treblo / SPAs no-Google: NO loops ni overlays (congelaban clics)
    const isNonGoogleApp = (() => {
      try {
        const h = String(location.hostname || '').toLowerCase();
        if (/accounts\.google\./i.test(h)) return false;
        return /treblo|rocketoolz|sonauto|digen|clerk|auth0|lovable|gamma|suno|udio|chatgpt|openai|claude|qwen|alibaba|tiktok|bytedance/i.test(h)
          || /\/(login|signin|sign-in|auth)(\/|$|\?)/i.test(String(location.pathname || '') + String(location.href || ''));
      } catch (e) { return true; }
    })();

    stopCensorLoops();
    // Quitar overlays fijos (bloquean interacción en React)
    try {
      document.querySelectorAll('.iamax-mask-overlay, .iamax-cred-mask').forEach((n) => n.remove());
    } catch (e) {}

    // Google: EMAIL → Siguiente. CONTRASEÑA → no re-inject ni auto-Next (recargas).
    if (isGoogle) {
      try {
        if (googleChallenge) {
          console.log('[IAMAX-INJECT] Google challenge/pwd: sin re-fill ni auto-Next');
          // Ya se rellenó en firstResult; no segundo injectAllFields a 200ms
        } else if (googleIdentifier || googleChooser) {
          setTimeout(() => { clickGoogleNext(); }, 200);
          setTimeout(() => { clickGoogleNext(); }, 600);
        } else {
          const hasPassNow = document.querySelector('input[name="Passwd"], input[type="password"]');
          if (!hasPassNow) {
            setTimeout(() => { clickGoogleNext(); }, 250);
          }
        }
      } catch (e) {}
    }

    if (isNonGoogleApp) {
      // Qwen / SPA: relleno + puntos, SIN overlays, y ACTIVAR Sign in (React state)
      const isQwen = isQwenHost;
      const unlockUi = () => {
        try {
          document.querySelectorAll('.iamax-mask-overlay, .iamax-cred-mask, #iamax-censor-style').forEach((n) => {
            try {
              // No borrar style de puntos en inputs; solo overlays
              if (n.id === 'iamax-censor-style') return;
              n.remove();
            } catch (e) {}
          });
          document.querySelectorAll('.iamax-mask-overlay, .iamax-cred-mask').forEach((n) => n.remove());
          if (document.body) {
            document.body.style.pointerEvents = '';
            document.body.style.userSelect = '';
          }
          if (document.documentElement) document.documentElement.style.pointerEvents = '';
          // Habilitar Sign in si hay email+pass rellenados
          const emailOk = Array.from(document.querySelectorAll('input[type="email"], input[type="text"], input[autocomplete="username"], input[autocomplete="email"]'))
            .some((el) => el.value && String(el.value).length > 2 && el.type !== 'password');
          const passOk = Array.from(document.querySelectorAll('input[type="password"]'))
            .some((el) => el.value && String(el.value).length > 0);
          document.querySelectorAll('button, a, [role="button"], input[type="submit"]').forEach((btn) => {
            try {
              if (btn.id && String(btn.id).includes('iamax-inject')) return;
              btn.style.removeProperty('pointer-events');
              btn.style.removeProperty('opacity');
              btn.style.removeProperty('visibility');
              const label = String(btn.textContent || btn.value || '').toLowerCase();
              // No forzar Qwen: saltaba React y enviaba credenciales en la URL.
              if (!isQwen && emailOk && passOk && /sign\s*in|log\s*in|iniciar|entrar|acceder|continue with email/i.test(label)) {
                btn.disabled = false;
                btn.removeAttribute('disabled');
                btn.removeAttribute('aria-disabled');
                btn.classList.remove('disabled', 'is-disabled', 'btn-disabled');
                try { btn.style.setProperty('pointer-events', 'auto', 'important'); } catch (e) {}
                try { btn.style.setProperty('opacity', '1', 'important'); } catch (e) {}
                try { btn.style.setProperty('cursor', 'pointer', 'important'); } catch (e) {}
              }
            } catch (e) {}
          });
        } catch (e) {}
      };
      const lightResecure = () => {
        try {
          unlockUi();
          // En Qwen: máscara muy suave (solo disc), color oscuro del form blanco
          document.querySelectorAll(
            'input[data-iamax-field="email"], input[data-iamax-field="password"], input[type="password"], input[type="email"]'
          ).forEach((el) => {
            if (!el.value) return;
            const isPass = el.type === 'password' || el.getAttribute('data-iamax-field') === 'password';
            if (isPass) {
              try { el.type = 'password'; el.setAttribute('type', 'password'); } catch (e) {}
            }
            el.style.setProperty('-webkit-text-security', 'disc', 'important');
            el.style.setProperty('text-security', 'disc', 'important');
            // Qwen form claro: puntos oscuros; Google/resto: puntos blancos
            el.style.setProperty('color', isQwen ? '#1a1a1a' : '#ffffff', 'important');
            el.style.setProperty('-webkit-text-fill-color', isQwen ? '#1a1a1a' : '#ffffff', 'important');
            el.style.setProperty('caret-color', isQwen ? '#1a1a1a' : '#ffffff', 'important');
            el.style.removeProperty('pointer-events');
            el.setAttribute('data-iamax-secured', '1');
          });
        } catch (e) {}
      };
      lightResecure();
      unlockUi();
      // Una sola re-aplicación corta (sin spam de reintentos)
      let attempts = 0;
      window.__iamaxInjectRetryTimer = setInterval(() => {
        attempts++;
        try {
          if (attempts === 1) injectAllFields();
          lightResecure();
          unlockUi();
        } catch (e) {}
        if (attempts >= 3) {
          stopCensorLoops();
          lightResecure();
          unlockUi();
        }
      }, 400);
      setTimeout(() => { stopCensorLoops(); lightResecure(); unlockUi(); }, 1600);
      setTimeout(unlockUi, 2500);
      return firstResult;
    }

    // Google: menos reintentos (el spam cada 500ms retrasaba el paso a contraseña)
    let attempts = 0;
    window.__iamaxInjectRetryTimer = setInterval(() => {
        attempts++;
        try {
          injectAllFields();
          resecureAll();
          if (window.__iamaxSetInjectedCreds) window.__iamaxSetInjectedCreds(email, password, totpCode);
          // En identifier o pwd: avanzar con Siguiente
          if (attempts === 1 || attempts === 3 || attempts === 5) clickGoogleNext();
        } catch (e) {}
        if (attempts >= 8) stopCensorLoops();
    }, 700);

    try {
      if (window.__iamaxCensorObserver) {
        try { window.__iamaxCensorObserver.disconnect(); } catch (e) {}
      }
      // Observer liviano: solo childList (no re-mask en cada tecla)
      window.__iamaxCensorObserver = new MutationObserver(() => {
        try {
          resecureAll();
        } catch (e) {}
      });
      window.__iamaxCensorObserver.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true
      });
    } catch (e) {}

    // Apagar loops a los 6s (antes 10s) — no interferir con Google
    setTimeout(stopCensorLoops, 6000);

    return firstResult;
};
