window.runIamaxInjection = function(email, password, totpCode) {
    console.log("[IAMAX-INJECT] Script inyectado en:", window.location.href);

    function querySelectorAllDeep(selector, root = document) {
        let results = Array.from(root.querySelectorAll(selector));
        const allElements = root.querySelectorAll('*');
        for (const el of allElements) {
            if (el.shadowRoot) {
                results = results.concat(querySelectorAllDeep(selector, el.shadowRoot));
            }
        }
        return results;
    }

    const setNativeValue = (element, value) => {
      if (element.value === value) return;
      try {
        let valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        try {
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            document.body.appendChild(iframe);
            const pureSetter = Object.getOwnPropertyDescriptor(iframe.contentWindow.HTMLInputElement.prototype, 'value')?.set;
            if (pureSetter) valueSetter = pureSetter;
            document.body.removeChild(iframe);
        } catch(err) {}

        const prototype = Object.getPrototypeOf(element);
        const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

        element.focus();

        if (valueSetter && prototypeValueSetter && valueSetter !== prototypeValueSetter) {
            prototypeValueSetter.call(element, value);
        } else if (valueSetter) {
            valueSetter.call(element, value);
        } else {
            element.value = value;
        }

        element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        element.blur();
      } catch(e) {
        console.error("[IAMAX-INJECT] Error en setNativeValue:", e);
        element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      }
    };

    const injectAllFields = () => {
        let eCount = 0, pCount = 0, tCount = 0;

        const emailInputs = querySelectorAllDeep('input[type="email"], input[name="email" i], input[name="username" i], input[name="identifier" i], input[id="email" i], input[id="username" i], input[id="identifierId"], input[autocomplete="username"], input[autocomplete="email"]');
        emailInputs.forEach(i => {
            const visible = !!(i.offsetWidth || i.offsetHeight || i.getClientRects().length);
            const looksLikeSearch = i.type === 'search' || /search|buscar|query|filter/i.test(`${i.name} ${i.id} ${i.placeholder} ${i.getAttribute('aria-label') || ''}`);
            if (visible && i.type !== 'hidden' && !looksLikeSearch && !i.value) {
                eCount++;
                try { i.type = 'password'; } catch(e) {}
                setNativeValue(i, email);
            }
        });

        const passInputs = querySelectorAllDeep('input[type="password"], input[name="password" i], input[name="passwd" i], input[id="password" i], input[id="passwd" i], input[autocomplete="current-password"], input[autocomplete="new-password"]');
        passInputs.forEach(i => {
            const visible = !!(i.offsetWidth || i.offsetHeight || i.getClientRects().length);
            if (visible && i.type !== 'hidden' && !i.value) {
                pCount++;
                setNativeValue(i, password);
            }
        });

        if (totpCode) {
            const totpInputs = querySelectorAllDeep(
              'input[type="tel"], input[inputmode="numeric"], input[name*="totp" i]:not([type="hidden"]), input[id*="totp" i]:not([type="hidden"]), input[name*="otp" i]:not([type="hidden"]), input[id*="otp" i]:not([type="hidden"]), input[name*="pin" i]:not([type="hidden"]), input[id*="pin" i]:not([type="hidden"]), input[id*="idv" i]:not([type="hidden"]), input[autocomplete="one-time-code"], input[aria-label*="código" i], input[aria-label*="codigo" i], input[aria-label*="code" i], input[placeholder*="código" i], input[placeholder*="codigo" i], input[placeholder*="Ingresar" i]'
            );
            const hideTotp = (i) => {
                try {
                  i.style.setProperty('-webkit-text-security', 'disc', 'important');
                  i.style.setProperty('user-select', 'none', 'important');
                  i.style.setProperty('caret-color', 'transparent', 'important');
                  i.style.setProperty('color', 'transparent', 'important');
                  i.style.setProperty('text-shadow', '0 0 0 #9aa0a6', 'important');
                  i.style.setProperty('filter', 'blur(7px)', 'important');
                  i.setAttribute('autocomplete', 'one-time-code');
                  i.setAttribute('data-iamax-otp-masked', '1');
                } catch (e) {}
            };
            totpInputs.forEach(i => {
                if (i.type !== 'hidden') {
                    if (i.value !== totpCode) {
                      tCount++;
                      setNativeValue(i, totpCode);
                    }
                    // Nunca mostrar el código en pantalla
                    hideTotp(i);
                }
            });
            // Por si Google usa un input sin name/id reconocible
            querySelectorAllDeep('input').forEach((i) => {
              if (i.type === 'hidden' || i.type === 'password') return;
              const digits = String(i.value || '').replace(/\s+/g, '');
              if (digits === String(totpCode).replace(/\s+/g, '') || /^(?:G-)?\d{4,8}$/i.test(String(i.value || '').trim())) {
                hideTotp(i);
              }
            });
        }

        const allInputs = querySelectorAllDeep('input');
        const inputDetails = allInputs.map(i => `[type=${i.type}, name=${i.name}, id=${i.id}]`).join(', ');
        return `e:${eCount}, p:${pCount}, t:${tCount} | Inputs: ${inputDetails}`;
    };

    const firstResult = injectAllFields();

    let attempts = 0;
    const interval = setInterval(() => {
        attempts++;
        const result = injectAllFields();
        const injected = /e:[1-9]|p:[1-9]|t:[1-9]/.test(result);
        if (injected || attempts >= 8) {
            clearInterval(interval);
        }
    }, 1000);

    return firstResult;
};
