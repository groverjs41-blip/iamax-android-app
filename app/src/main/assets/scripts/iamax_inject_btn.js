(function() {
    // ==========================================
    // INJECT BUTTON LOGIC - v1.3.9
    // Diseñado para funcionar AUNQUE chrome.storage no esté disponible
    // (modo incógnito aislado de Lovable)
    // ==========================================

    // --- Leer datos de inyección ---
    // Fuente primaria: window.sessionStorage (escrito por generateFingerprintExtension.js)
    // Fuente secundaria: chrome.storage.session / chrome.storage.local (si disponible)
    function readInjectData(callback) {
        var result = {};

        // 1) Intentar sessionStorage primero (siempre disponible)
        try {
            var cardId = window.sessionStorage.getItem('iamax_pendingInjectCardId');
            var canInject = window.sessionStorage.getItem('iamax_clientCanInject');
            var method = window.sessionStorage.getItem('iamax_clientInjectMethod');
            var isOwner = window.sessionStorage.getItem('iamax_isOwner');

            if (cardId) result.pendingInjectCardId = JSON.parse(cardId);
            if (canInject !== null) result.clientCanInject = JSON.parse(canInject);
            if (method) result.clientInjectMethod = JSON.parse(method);
            if (isOwner !== null) result.isOwner = JSON.parse(isOwner);
        } catch(e) {}

        // Si ya tenemos todo de sessionStorage, devolver inmediatamente
        if (result.pendingInjectCardId) {
            callback(result);
            return;
        }

        // 2) Intentar chrome.storage como fallback
        try {
            var chromeApi = window.iamaxChrome || window.chrome;
            if (chromeApi && chromeApi.storage) {
                var sessionApi = chromeApi.storage.session;
                var localApi = chromeApi.storage.local;
                var keys = ["pendingInjectCardId", "clientCanInject", "clientInjectMethod", "isOwner"];

                var merge = function(a, b) {
                    var out = {};
                    for (var k in a) if (a[k] !== undefined) out[k] = a[k];
                    for (var k in b) if (out[k] === undefined && b[k] !== undefined) out[k] = b[k];
                    return out;
                };

                if (sessionApi) {
                    sessionApi.get(keys, function(sess) {
                        localApi.get(keys, function(loc) {
                            callback(merge(merge(result, sess), loc));
                        });
                    });
                } else if (localApi) {
                    localApi.get(keys, function(loc) {
                        callback(merge(result, loc));
                    });
                } else {
                    callback(result);
                }
                return;
            }
        } catch(e) {}

        // 3) Sin ninguna fuente disponible - devolver lo que tenemos
        callback(result);
    }

    // --- Mostrar el botón ---
    function showButton(cardId) {
        if (document.getElementById("iamax-inject-floating-btn")) return;
        if (window.__iamaxInjectDone === true || window.__iamaxAllowInjectBtn === false) return;

        var btn = document.createElement("button");
        btn.id = "iamax-inject-floating-btn";
        btn.setAttribute("data-iamax-inject", "1");
        btn.textContent = "\u26a1 Inyectar IAmax";

        Object.assign(btn.style, {
            position: "fixed",
            top: "10px",
            left: "10px",
            zIndex: "2147483647",
            padding: "8px 18px",
            background: "linear-gradient(135deg, #ff0055, #cc0044)",
            color: "white",
            border: "none",
            borderRadius: "20px",
            fontSize: "13px",
            fontWeight: "bold",
            cursor: "pointer",
            boxShadow: "0 2px 10px rgba(255, 0, 85, 0.4)",
            fontFamily: "system-ui, -apple-system, sans-serif",
            transition: "all 0.2s ease",
            opacity: "0.85"
        });

        btn.onmouseover = function() {
            btn.style.opacity = "1";
            btn.style.transform = "scale(1.05)";
            btn.style.boxShadow = "0 4px 18px rgba(255, 0, 85, 0.7)";
        };
        btn.onmouseout = function() {
            btn.style.opacity = "0.85";
            btn.style.transform = "scale(1)";
            btn.style.boxShadow = "0 2px 10px rgba(255, 0, 85, 0.4)";
        };

        btn.onclick = function() {
            btn.textContent = "\u23f3 Inyectando...";
            btn.style.background = "linear-gradient(135deg, #666, #444)";

            try {
                var chromeApi = window.iamaxChrome || window.chrome;
                chromeApi.runtime.sendMessage({ type: "AUTO_INJECT_NOW", cardId: cardId }, function(response) {
                    if (response && response.success) {
                        btn.textContent = "\u2705 " + (response.message || "\u00a1Listo!");
                        btn.style.background = "linear-gradient(135deg, #00cc66, #00994d)";
                        setTimeout(function() {
                            btn.textContent = "\u26a1 Inyectar IAmax";
                            btn.style.background = "linear-gradient(135deg, #ff0055, #cc0044)";
                        }, 2000);
                    } else {
                        var errMsg = (response && response.error) ? response.error : "Reintenta";
                        btn.textContent = "\u274c " + errMsg.substring(0, 20);
                        btn.style.background = "linear-gradient(135deg, #cc0000, #990000)";
                        setTimeout(function() {
                            btn.textContent = "\u26a1 Inyectar IAmax";
                            btn.style.background = "linear-gradient(135deg, #ff0055, #cc0044)";
                        }, 4000);
                    }
                });
            } catch(e) {
                btn.textContent = "\u274c Error: " + e.message.substring(0, 15);
                btn.style.background = "linear-gradient(135deg, #cc0000, #990000)";
            }
        };

        function mountBtn() {
            if (window.__iamaxInjectDone === true || window.__iamaxAllowInjectBtn === false) {
                if (btn.parentNode) btn.remove();
                return;
            }
            if (!document.getElementById("iamax-inject-floating-btn") && document.documentElement) {
                document.documentElement.appendChild(btn);
            }
        }

        mountBtn();
        setInterval(mountBtn, 1000);
    }

    // --- Lógica principal con reintento ---
    var attempts = 0;
    function tryInit() {
        attempts++;
        readInjectData(function(data) {
            if (!data || !data.pendingInjectCardId) {
                if (attempts < 30) setTimeout(tryInit, 300);
                return;
            }

            // Verificar permisos
            var method = String(data.clientInjectMethod || "").trim().toLowerCase();
            if (method !== "google") return; // Solo mostrar en flujo Google OAuth

            var isOwner = data.isOwner === true;
            var canInject = isOwner || data.clientCanInject === true;
            if (!canInject) return;

            showButton(data.pendingInjectCardId);
        });
    }

    // Iniciar inmediatamente y también al cargar el DOM
    tryInit();
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", tryInit);
    }
})();
