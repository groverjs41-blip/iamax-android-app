(() => {
// Universal shield and auto-injector for sites like Treblo/Sonauto

const sensitiveInputSelector = [
    'input[type="email"]',
    'input[type="password"]',
    'input[autocomplete="username"]',
    'input[autocomplete="email"]',
    'input[autocomplete="current-password"]',
    'input[autocomplete="new-password"]',
    'input[autocomplete="one-time-code"]',
    'input[name*="email" i]',
    'input[id*="email" i]',
    'input[name*="user" i]',
    'input[id*="user" i]',
    'input[name*="pass" i]',
    'input[id*="pass" i]',
    'input[name*="otp" i]',
    'input[id*="otp" i]',
    'input[name*="totp" i]',
    'input[id*="totp" i]',
    'input[name*="mfa" i]',
    'input[id*="mfa" i]',
    'input[name*="2fa" i]',
    'input[id*="2fa" i]',
    'input[name*="auth" i]',
    'input[id*="auth" i]',
    'input[name*="verification" i]',
    'input[id*="verification" i]',
    'input[aria-label*="otp" i]',
    'input[aria-label*="totp" i]',
    'input[aria-label*="mfa" i]',
    'input[aria-label*="2fa" i]',
    'input[aria-label*="authentication" i]',
    'input[aria-label*="authenticator" i]',
    'input[aria-label*="autenticacion" i]',
    'input[aria-label*="verification" i]',
    'input[aria-label*="verificacion" i]',
    'input[placeholder*="otp" i]',
    'input[placeholder*="totp" i]',
    'input[placeholder*="mfa" i]',
    'input[placeholder*="2fa" i]',
    'input[placeholder*="authentication" i]',
    'input[placeholder*="authenticator" i]',
    'input[placeholder*="autenticacion" i]',
    'input[placeholder*="verification" i]',
    'input[placeholder*="verificacion" i]'
].join(',');

function isSensitiveElement(element) {
    return Boolean(element?.closest?.(`${sensitiveInputSelector}, [data-identifier]`));
}

function selectionTouchesSensitiveElement() {
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0) return false;

    const anchor = selection.anchorNode?.nodeType === Node.ELEMENT_NODE
        ? selection.anchorNode
        : selection.anchorNode?.parentElement;
    const focus = selection.focusNode?.nodeType === Node.ELEMENT_NODE
        ? selection.focusNode
        : selection.focusNode?.parentElement;

    return isSensitiveElement(anchor) || isSensitiveElement(focus);
}

function protectSensitiveCopy(event) {
    if (isSensitiveElement(event.target) || selectionTouchesSensitiveElement()) {
        event.preventDefault();
        event.stopPropagation();
    }
}

function blockPasswordReveal(event) {
    const control = event.target?.closest?.('button, [role="button"]');
    if (!control) return;
    const label = [control.getAttribute('aria-label'), control.getAttribute('title'), control.textContent]
        .filter(Boolean).join(' ').toLowerCase();
    const passwordInput = control.parentElement?.querySelector?.('input[type="password"], input[name*="password" i], input[name*="pass" i]');
    if (!passwordInput || (label && !/show|mostrar|ver|reveal|visibility|password|contrase/.test(label))) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
}

document.addEventListener('copy', protectSensitiveCopy, true);
document.addEventListener('cut', protectSensitiveCopy, true);
document.addEventListener('dragstart', protectSensitiveCopy, true);
document.addEventListener('click', blockPasswordReveal, true);

function isGoogleAppShell() {
    try {
        const h = String(location.hostname || '').toLowerCase();
        // No tocar UI de Gemini ya logueado (evita texto negro / rarezas en el chat)
        if (/^gemini\.google\.|^aistudio\.google\.|^notebooklm\.google\.|^labs\.google/i.test(h)) return true;
        return false;
    } catch (e) {
        return false;
    }
}

// 1. Hide sensitive inputs so they look like passwords (solo en login, no en apps)
function hideInputs() {
    if (isGoogleAppShell()) return;
    // En páginas de app sin form de login, no enmascarar nada
    try {
        const path = String(location.pathname || '');
        if (/\/app(\/|$)/i.test(path) && !/accounts\.google/i.test(location.hostname || '')) return;
    } catch (e) {}

    const sensitiveInputs = document.querySelectorAll(sensitiveInputSelector);
    sensitiveInputs.forEach(el => {
        if (el.type !== 'hidden') {
            // Solo password/OTP en pantallas de login — no email genérico en SPAs
            const t = String(el.type || '').toLowerCase();
            const meta = [el.name, el.id, el.autocomplete, el.placeholder].join(' ').toLowerCase();
            const isPassOrOtp = t === 'password' || /pass|otp|totp|2fa|mfa|auth/.test(meta);
            if (!isPassOrOtp) return;
            if (el.style.webkitTextSecurity !== "disc") {
                el.style.setProperty('-webkit-text-security', 'disc', 'important');
            }
        }
    });

    // Solo en accounts.google.com censurar chips de email en texto
    if (!/accounts\.google\./i.test(String(location.hostname || ''))) return;

    const accountRoots = document.querySelectorAll('[data-identifier], [data-email]');
    accountRoots.forEach(root => {
        [root, ...root.querySelectorAll('*')].forEach(element => {
            if (element.children.length > 0) return;
            const value = String(element.textContent || '').trim();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return;
            element.style.setProperty('-webkit-text-security', 'disc', 'important');
            element.style.setProperty('color', 'transparent', 'important');
            element.style.setProperty('text-shadow', '0 0 8px rgba(255,255,255,.75)', 'important');
        });
    });
}

// Keep hiding them if they dynamically appear
const observer = new MutationObserver(() => {
    hideInputs();
    checkIfFilledAndSubmit();
});

observer.observe((document.documentElement || document), {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['type', 'value', 'style']
});

let autoSubmitted = false;
let injectionRequested = false;

function checkIfFilledAndSubmit() {
    if (autoSubmitted) return;

    const passInput = document.querySelector('input[type="password"]');
    if (passInput && passInput.value && passInput.value.length > 0) {
        const submitBtn = document.querySelector('button[type="submit"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.toLowerCase().includes('log in') || b.textContent.toLowerCase().includes('iniciar'));
        if (submitBtn) {
            autoSubmitted = true;
            setTimeout(() => {
                submitBtn.click();
            }, 500);
        }
    }
}

function requestInjection() {
    if (injectionRequested) return;

    const readStorage = (keys, callback) => {
        const sessionApi = chrome.storage?.session;
        const localApi = chrome.storage?.local;
        if (!sessionApi) {
            localApi.get(keys, callback);
            return;
        }
        sessionApi.get(keys, (sessionRes) => {
            const normalized = Array.isArray(keys) ? keys : [keys];
            const missing = normalized.filter((key) => sessionRes[key] === undefined);
            if (!missing.length) return callback(sessionRes);
            localApi.get(missing, (localRes) => {
                const merged = { ...sessionRes, ...localRes };
                const toMigrate = {};
                missing.forEach((key) => {
                    if (localRes[key] !== undefined) toMigrate[key] = localRes[key];
                });
                if (!Object.keys(toMigrate).length) return callback(merged);
                sessionApi.set(toMigrate, () => {
                    localApi.remove(Object.keys(toMigrate), () => callback(merged));
                });
            });
        });
    };

    readStorage(["pendingInjectCardId"], (res) => {
        if (res.pendingInjectCardId) {
            injectionRequested = true;
            setTimeout(() => {
                chrome.runtime.sendMessage({ type: "AUTO_INJECT_NOW" });
            }, 1000);
        }
    });
}

hideInputs();
requestInjection();

})();
