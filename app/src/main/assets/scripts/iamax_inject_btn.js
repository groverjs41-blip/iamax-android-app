(async function() {
    // ==========================================
    // INJECT BUTTON LOGIC
    // ==========================================
    if (!window.iamaxChrome || !window.iamaxChrome.storage) return;

    const readStorage = (keys, callback) => {
        const sessionApi = window.iamaxChrome.storage.session;
        const localApi = window.iamaxChrome.storage.local;
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
    };

    // Solo método Google: owner siempre; clientes si client_can_inject.
    // Si Chromium ya puso el botón cyan, no montar un segundo encima.
    readStorage(["pendingInjectCardId", "clientCanInject", "clientInjectMethod", "isOwner"], (result) => {
        if (!result || !result.pendingInjectCardId) return;
        if (window.__iamaxInjectDone === true || window.__iamaxAllowInjectBtn === false) return;
        const method = String(result.clientInjectMethod || "").trim().toLowerCase();
        if (method !== "google") return;
        const isOwner = result.isOwner === true;
        const canInject = isOwner || result.clientCanInject === true;
        if (!canInject) return;

        const cardId = result.pendingInjectCardId;

        // Un solo botón: no superponer al cyan de Chromium ni duplicar
        if (document.getElementById("iamax-inject-btn") || document.querySelector("button[data-iamax-inject='1']")) return;
        if (document.getElementById("iamax-inject-floating-btn") || document.getElementById("iamax-inject-floating-container")) return;

        const container = document.createElement("div");
        container.id = "iamax-inject-floating-container";
        const isMobile = window.innerWidth <= 640 || 'ontouchstart' in window;
        container.style.cssText = `
            position: fixed !important;
            bottom: ${isMobile ? '76px' : '24px'} !important;
            right: ${isMobile ? '14px' : '20px'} !important;
            z-index: 2147483647 !important;
            display: flex !important;
            align-items: center !important;
            gap: 6px !important;
            font-family: system-ui, -apple-system, sans-serif !important;
        `;

        const btn = document.createElement("button");
        btn.id = "iamax-inject-floating-btn";
        btn.setAttribute("data-iamax-inject", "1");
        btn.innerHTML = "⚡ Inyectar";
        btn.style.cssText = `
            padding: ${isMobile ? '8px 14px' : '10px 18px'} !important;
            background: linear-gradient(135deg, #6366F1, #4F46E5) !important;
            color: white !important;
            border: none !important;
            border-radius: 25px !important;
            font-size: ${isMobile ? '13px' : '14px'} !important;
            font-weight: bold !important;
            cursor: pointer !important;
            box-shadow: 0 4px 15px rgba(99, 102, 241, 0.5) !important;
            transition: all 0.2s ease !important;
        `;

        const closeBtn = document.createElement("button");
        closeBtn.innerHTML = "✕";
        closeBtn.title = "Ocultar botón";
        closeBtn.style.cssText = `
            width: 26px !important;
            height: 26px !important;
            border-radius: 50% !important;
            background: rgba(15, 23, 42, 0.8) !important;
            color: #94A3B8 !important;
            border: 1px solid rgba(255, 255, 255, 0.2) !important;
            font-size: 13px !important;
            cursor: pointer !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            padding: 0 !important;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4) !important;
        `;
        closeBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            container.remove();
            window.__iamaxAllowInjectBtn = false;
        };

        container.appendChild(btn);
        container.appendChild(closeBtn);

        btn.addEventListener("mouseover", () => {
            btn.style.setProperty("transform", "scale(1.05)", "important");
            btn.style.setProperty("box-shadow", "0 6px 20px rgba(99, 102, 241, 0.7)", "important");
        });
        btn.addEventListener("mouseout", () => {
            btn.style.setProperty("transform", "scale(1)", "important");
            btn.style.setProperty("box-shadow", "0 4px 15px rgba(99, 102, 241, 0.5)", "important");
        });

        btn.addEventListener("click", () => {
            btn.innerHTML = "⏳ Inyectando...";
            btn.style.setProperty("background", "linear-gradient(135deg, #666, #444)", "important");
            
            window.iamaxChrome.runtime.sendMessage({ type: "AUTO_INJECT_NOW", cardId: cardId }, (response) => {
                if (response && response.success) {
                    btn.innerHTML = "✅ " + (response.message || "¡Listo!");
                    btn.style.setProperty("background", "linear-gradient(135deg, #00cc66, #00994d)", "important");
                    window.__iamaxInjectDone = true;
                    window.__iamaxAllowInjectBtn = false;
                    setTimeout(() => container.remove(), 1000);
                } else {
                    console.error("Injection error:", response);
                    const errMsg = response && response.error ? response.error : "Reintenta";
                    btn.innerHTML = "❌ " + errMsg.substring(0, 20);
                    btn.style.setProperty("background", "linear-gradient(135deg, #cc0000, #990000)", "important");
                    setTimeout(() => {
                        btn.innerHTML = "⚡ Inyectar";
                        btn.style.setProperty("background", "linear-gradient(135deg, #6366F1, #4F46E5)", "important");
                    }, 4000);
                }
            });
        });

        const mountBtn = () => {
            if (document.body) {
                document.body.appendChild(container);
            } else if (document.documentElement) {
                document.documentElement.appendChild(container);
            }
        };

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", mountBtn);
        } else {
            mountBtn();
        }
    });
})();
