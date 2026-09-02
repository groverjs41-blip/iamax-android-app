(() => {
// Protege los correos electrónicos en la página de inicio de sesión de Google
// para que no sean visibles ni copiables.

// Evitar ejecutar el escudo o inyectar botones si estamos dentro de un iframe
// Esto previene que rompamos el flujo de autenticación de aplicaciones como Google Flow (labs.google)
console.log("IAMAX DEBUG: Ejecutando google_shield.js...");
const isIframe = window.top !== window.self;
console.log("IAMAX DEBUG: isIframe =", isIframe);

let scheduled = false;

function applyOtpMaskStyle(el) {
    if (!el || el.nodeType !== 1) return;
    el.style.setProperty('-webkit-text-security', 'disc', 'important');
    el.style.setProperty('user-select', 'none', 'important');
    el.style.setProperty('caret-color', '#ffffff', 'important');
    el.style.setProperty('color', '#ffffff', 'important');
    el.style.setProperty('-webkit-text-fill-color', '#ffffff', 'important');
    el.style.setProperty('text-shadow', 'none', 'important');
    el.style.setProperty('filter', 'none', 'important');
    try { el.setAttribute('autocomplete', 'one-time-code'); } catch (e) {}
    try { el.setAttribute('data-iamax-otp-masked', '1'); } catch (e) {}
}

function isOtpLikeValue(raw) {
    const v = String(raw || '').trim();
    if (!v) return false;
    // 776 933 | 776933 | 12 34 56 | G-123456
    return /^(?:G-)?\d{3}\s?\d{3}$/i.test(v) || /^\d{4,8}$/.test(v.replace(/\s+/g, ''));
}

function looksLikeOtpInput(el) {
    if (!el || el.type === 'hidden' || el.type === 'checkbox' || el.type === 'radio' || el.type === 'password') return false;
    const maxLen = Number(el.maxLength) || 0;
    if (maxLen > 12) return false;
    const meta = [
        el.id, el.name, el.getAttribute('autocomplete'), el.getAttribute('aria-label'),
        el.getAttribute('placeholder'), el.getAttribute('inputmode'), el.className
    ].join(' ').toLowerCase();
    if (/totp|otp|pin|idv|sms|verif|c[oó]digo|code|challenge|one-time|2fa|mfa/.test(meta)) return true;
    if (el.type === 'tel' || el.getAttribute('inputmode') === 'numeric') {
        if (isOtpLikeValue(el.value) || maxLen > 0 && maxLen <= 8) return true;
    }
    if (isOtpLikeValue(el.value)) return true;
    return false;
}

function maskCodeInputs() {
    // Código 2FA / TOTP: no debe verse en pantalla (inputs + texto grande de Google)
    if (!document.getElementById('iamax-totp-mask-style')) {
        const style = document.createElement('style');
        style.id = 'iamax-totp-mask-style';
        style.textContent = `
          input[autocomplete="one-time-code"],
          input[type="tel"],
          input[inputmode="numeric"],
          input[name*="totp" i], input[id*="totp" i],
          input[name*="otp" i], input[id*="otp" i],
          input[name*="pin" i], input[id*="pin" i],
          input[id*="idv" i], input[name*="idv" i],
          input[aria-label*="código" i], input[aria-label*="codigo" i],
          input[aria-label*="code" i], input[placeholder*="código" i],
          input[placeholder*="codigo" i],
          input[data-iamax-otp-masked="1"],
          [data-iamax-otp-text="1"] {
            -webkit-text-security: disc !important;
            user-select: none !important;
            caret-color: #ffffff !important;
            color: #ffffff !important;
            -webkit-text-fill-color: #ffffff !important;
            text-shadow: none !important;
            filter: none !important;
          }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    const selectors = [
        'input[autocomplete="one-time-code"]',
        'input[type="tel"]',
        'input[inputmode="numeric"]',
        'input[name*="totp" i]', 'input[id*="totp" i]',
        'input[name*="otp" i]', 'input[id*="otp" i]',
        'input[name*="pin" i]', 'input[id*="pin" i]',
        'input[id*="idv" i]', 'input[name*="idv" i]',
        'input[aria-label*="código" i]', 'input[aria-label*="codigo" i]',
        'input[aria-label*="code" i]', 'input[placeholder*="código" i]',
        'input[placeholder*="codigo" i]', 'input[placeholder*="Ingresar el código" i]',
        'input[placeholder*="código de verificación" i]',
        'input[data-iamax-otp-masked="1"]'
    ];
    try {
        document.querySelectorAll(selectors.join(',')).forEach((el) => {
            if (looksLikeOtpInput(el) || el.getAttribute('data-iamax-otp-masked') === '1') {
                applyOtpMaskStyle(el);
            }
        });
    } catch (e) {}

    // Cualquier input con valor tipo OTP (Google a veces no marca bien el name/id)
    try {
        document.querySelectorAll('input').forEach((el) => {
            if (looksLikeOtpInput(el)) applyOtpMaskStyle(el);
        });
    } catch (e) {}

    // Texto grande con el código visible (hojas del DOM en challenge de Google)
    try {
        const host = String(location.hostname || '');
        if (/accounts\.google\.|google\.[a-z.]+$/i.test(host) || /challenge|signin|v3\/signin|idv/i.test(location.pathname + location.search)) {
            const pageText = String(document.body?.innerText || '').toLowerCase();
            const onChallenge = /verificaci[oó]n|verification|c[oó]digo|authenticator|mensaje de texto|text message|2-step|two-step|ingresar el c[oó]digo/.test(pageText);
            if (onChallenge) {
                document.querySelectorAll('div, span, p, h1, h2, label, strong, b').forEach((el) => {
                    if (el.children && el.children.length > 0) return;
                    const text = String(el.textContent || '').trim();
                    if (!isOtpLikeValue(text)) return;
                    // No tocar botones ni menús
                    if (el.closest('button, a, [role="button"], nav, footer')) return;
                    el.setAttribute('data-iamax-otp-text', '1');
                    el.style.setProperty('filter', 'blur(8px)', 'important');
                    el.style.setProperty('color', 'transparent', 'important');
                    el.style.setProperty('text-shadow', '0 0 10px rgba(255,255,255,0.55)', 'important');
                    el.style.setProperty('user-select', 'none', 'important');
                    el.style.setProperty('pointer-events', 'none', 'important');
                });
            }
        }
    } catch (e) {}
}

function runShield() {
    if (isIframe) return;
    
    // Buscar elementos que puedan contener el correo
    const elements = document.querySelectorAll('div, span, p, [data-identifier]');
    
    elements.forEach(el => {
        // Solo aplicar si el elemento es una hoja (sin hijos) o es específicamente el data-identifier
        if (el.children.length === 0 || el.hasAttribute('data-identifier')) {
            const text = el.textContent.trim();
            // Regex básico para detectar correos
            if (text.includes('@') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
                if (el.style.webkitTextSecurity !== "disc") {
                    el.style.webkitTextSecurity = "disc";
                    el.style.pointerEvents = "none";
                    
                    // Si no permite webkitTextSecurity, forzar texto
                    if (getComputedStyle(el).webkitTextSecurity !== "disc") {
                         el.textContent = "••••••••••@gmail.com";
                    }
                }
                
                // Ocultar también el nombre del perfil (suele ser el elemento anterior o estar cerca)
                if (el.previousElementSibling && el.previousElementSibling.textContent.length < 40) {
                    el.previousElementSibling.style.webkitTextSecurity = "disc";
                    el.previousElementSibling.style.color = "transparent";
                    el.previousElementSibling.style.textShadow = "0 0 8px rgba(255,255,255,0.8)";
                }
            }
        }
    });

    maskCodeInputs();
    ensureInjectButton();
}

const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
        scheduled = false;
        runShield();
    });
});

observer.observe((document.documentElement || document), { 
    childList: true, 
    subtree: true, 
    characterData: true 
});

let pendingInjectCardId = null;
let pendingInjectMethod = "";

function isGoogleInjectAllowed() {
    if (window.__iamaxInjectDone === true) return false;
    // Chromium embebido marca explícitamente si el método es Google
    if (window.__iamaxAllowInjectBtn === false) return false;
    if (window.__iamaxLoginMethod !== undefined && window.__iamaxLoginMethod !== null && window.__iamaxLoginMethod !== "") {
        return String(window.__iamaxLoginMethod).trim().toLowerCase() === "google";
    }
    const method = String(pendingInjectMethod || "").trim().toLowerCase();
    return method === "google";
}

function readSessionStorage(keys, callback) {
    const storage = chrome?.storage;
    const sessionApi = storage?.session;
    const localApi = storage?.local;
    if (!localApi && !sessionApi) return;
    if (!sessionApi) {
        localApi.get(keys, callback);
        return;
    }
    sessionApi.get(keys, (sessionRes) => {
        const missing = keys.filter((key) => sessionRes[key] === undefined);
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
}

function removeAllInjectButtons() {
    try {
        document.querySelectorAll("#iamax-inject-btn, #iamax-inject-floating-btn, button[data-iamax-inject='1']").forEach((el) => el.remove());
    } catch (e) {}
}

/** Solo mostrar inject en login Google; al re-entrar a iniciar sesión vuelve a salir. */
function needsGoogleLoginInject() {
    try {
        const host = String(location.hostname || "").toLowerCase();
        const path = String(location.pathname || "") + String(location.search || "");
        const href = String(location.href || "");
        if (!/accounts\.google\./i.test(host)) return false;
        if (/^myaccount\.google\./i.test(host) && !document.querySelector('input[type="password"], input[type="email"]')) {
            return false;
        }
        const hasUi = Boolean(document.querySelector(
            'input[type="email"], input[type="password"], input[name="identifier"], input[name="Passwd"], #identifierId, [data-identifier]'
        ));
        const signInUrl = /ServiceLogin|signin|identifier|challenge|v3\/signin|AddSession|oauth|AccountChooser|InteractiveLogin|password|totp|idv|consent|continue=/i.test(path + href);
        if (signInUrl || hasUi || /accounts\.google\./i.test(host)) {
            // Re-entrar a Google login: permitir inject otra vez
            window.__iamaxInjectDone = false;
            if (window.__iamaxAllowInjectBtn === false && window.__iamaxLoginMethod === "google") {
                window.__iamaxAllowInjectBtn = true;
            }
            return true;
        }
        return false;
    } catch (e) {
        return false;
    }
}

function checkStorageAndInject() {
    if (window.__iamaxInjectDone === true || window.__iamaxAllowInjectBtn === false) {
        removeAllInjectButtons();
        return;
    }
    // Ya en cuenta / sin form de login → no botón
    if (!needsGoogleLoginInject()) {
        removeAllInjectButtons();
        return;
    }
    readSessionStorage(["pendingInjectCardId", "clientInjectMethod"], (res) => {
        if (res.clientInjectMethod) {
            pendingInjectMethod = String(res.clientInjectMethod).trim().toLowerCase();
        }
        if (res.pendingInjectCardId && isGoogleInjectAllowed() && pendingInjectMethod !== "manual" && pendingInjectMethod !== "clerk_password" && pendingInjectMethod !== "clerk_code") {
            if (pendingInjectMethod && pendingInjectMethod !== "google") {
                removeAllInjectButtons();
                return;
            }
            pendingInjectCardId = res.pendingInjectCardId;
            ensureInjectButton();
        } else {
            removeAllInjectButtons();
        }
    });
}

checkStorageAndInject();
setInterval(checkStorageAndInject, 2000);

function ensureInjectButton() {
    if (isIframe) return;
    if (window.__iamaxInjectDone === true) {
        removeAllInjectButtons();
        return;
    }
    if (!needsGoogleLoginInject()) {
        removeAllInjectButtons();
        return;
    }
    if (!isGoogleInjectAllowed()) {
        removeAllInjectButtons();
        return;
    }
    // Preferir cardId de storage; si no, el del perfil Chromium
    const cardId = pendingInjectCardId || window.__iamaxPendingInjectCardId || null;
    if (!cardId) return;
    // Si Chromium ya montó el botón standalone, no duplicar
    if (document.getElementById("iamax-inject-btn") || document.querySelector("button[data-iamax-inject='1']")) return;
    if (document.getElementById("iamax-inject-floating-btn")) {
        document.getElementById("iamax-inject-floating-btn").remove();
    }
    const host = document.body || document.documentElement;
    if (!host) return;

    const btn = document.createElement("button");
    btn.id = "iamax-inject-btn";
    btn.type = "button";
    btn.setAttribute("data-iamax-inject", "1");
    btn.textContent = "INYECTAR IAMAX";
    Object.assign(btn.style, {
        position: "fixed",
        bottom: "24px",
        right: "24px",
        padding: "16px 24px",
        backgroundColor: "#00E5FF",
        color: "#000",
        border: "none",
        borderRadius: "50px",
        fontSize: "16px",
        fontWeight: "bold",
        cursor: "pointer",
        boxShadow: "0 8px 24px rgba(0, 229, 255, 0.4)",
        zIndex: "2147483647",
        transition: "transform 0.2s, background-color 0.2s"
    });
    
    btn.onmouseover = () => {
        btn.style.transform = "scale(1.05)";
        btn.style.backgroundColor = "#fff";
    };
    btn.onmouseout = () => {
        btn.style.transform = "scale(1)";
        btn.style.backgroundColor = "#00E5FF";
    };
    
    btn.onclick = async () => {
        btn.textContent = "Inyectando...";
        btn.style.opacity = "0.8";
        btn.style.pointerEvents = "none";

        // 1) Chromium embebido — el botón SE QUEDA en pass/2FA (no se cierra al inyectar correo)
        if (typeof window.__iamaxDoInject === "function") {
            try {
                const response = await window.__iamaxDoInject();
                if (response && response.success) {
                    btn.textContent = needsGoogleLoginInject() ? "Seguir (pass/2FA)" : "¡Listo!";
                    btn.style.backgroundColor = "#00ff88";
                } else {
                    btn.textContent = (response && response.error) ? String(response.error).slice(0, 28) : "Error";
                    btn.style.backgroundColor = "#ff4d4d";
                }
            } catch (e) {
                btn.textContent = "Error";
                btn.style.backgroundColor = "#ff4d4d";
            }
            setTimeout(() => {
                if (!needsGoogleLoginInject()) {
                    removeAllInjectButtons();
                    return;
                }
                btn.style.opacity = "1";
                btn.textContent = "INYECTAR IAMAX";
                btn.style.pointerEvents = "auto";
                btn.style.backgroundColor = "#00E5FF";
            }, 1800);
            return;
        }

        // 2) Electron / extension runtime
        const runtime = (window.iamaxChrome && window.iamaxChrome.runtime) || (window.chrome && window.chrome.runtime);
        if (!runtime || !runtime.sendMessage) {
            btn.textContent = "Sin canal inject";
            btn.style.backgroundColor = "#ff4d4d";
            btn.style.pointerEvents = "auto";
            btn.style.opacity = "1";
            return;
        }
        runtime.sendMessage({ type: "AUTO_INJECT_NOW", cardId }, (response) => {
            if (response && response.success) {
                // Seguir en login Google (pass/2FA): no quitar botón
                btn.textContent = needsGoogleLoginInject() ? "Seguir (pass/2FA)" : "¡Listo!";
                btn.style.backgroundColor = "#00ff88";
                setTimeout(() => {
                    if (!needsGoogleLoginInject()) {
                        removeAllInjectButtons();
                        return;
                    }
                    btn.textContent = "INYECTAR IAMAX";
                    btn.style.backgroundColor = "#00E5FF";
                    btn.style.pointerEvents = "auto";
                    btn.style.opacity = "1";
                }, 1800);
            } else {
                btn.textContent = response ? (response.error || "Error") : "Error de comunicación";
                btn.style.backgroundColor = "#ff4d4d";
                btn.style.pointerEvents = "auto";
                btn.style.opacity = "1";
                setTimeout(() => {
                    if (!needsGoogleLoginInject()) return;
                    btn.textContent = "INYECTAR IAMAX";
                    btn.style.backgroundColor = "#00E5FF";
                }, 3000);
            }
        });
    };
    
    host.appendChild(btn);
}

})();
