// Floating same-site cache cleaner.
(async function() {
  if (window.self !== window.top) return;

  function getChromeRuntime() {
    return globalThis.iamaxChrome?.runtime || globalThis.chrome?.runtime || null;
  }

  function getStorage() {
    return globalThis.iamaxChrome?.storage?.local || globalThis.chrome?.storage?.local || null;
  }

  async function getStorageValue(key) {
    try {
      const storage = getStorage();
      if (!storage?.get) return undefined;
      const state = await storage.get([key]);
      return state?.[key];
    } catch (error) {
      return undefined;
    }
  }

  async function isEnabled() {
    if (globalThis.iamaxModules?.isEnabled) {
      return globalThis.iamaxModules.isEnabled("clear-cache");
    }
    if (globalThis.__iamaxClearCacheButtonEnabled === true) return true;
    if (globalThis.iamaxProfileFlags?.clearCacheButton === true) return true;
    return Boolean(await getStorageValue("pendingClearCacheBtn"));
  }

  async function clearVisiblePageCache() {
    try {
      if (globalThis.caches?.keys) {
        const cacheNames = await globalThis.caches.keys();
        await Promise.all(cacheNames.map((name) => globalThis.caches.delete(name)));
      }
    } catch (error) {}
    try {
      if (navigator.serviceWorker?.getRegistrations) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
    } catch (error) {}
  }

  async function requestChromeCacheClear() {
    const runtime = getChromeRuntime();
    if (!runtime?.sendMessage) return { success: true };
    return new Promise((resolve) => {
      runtime.sendMessage(
        {
          type: "CLEAR_DOMAIN_CACHE_NO_COOKIES",
          url: window.location.href
        },
        (response) => {
          const lastError = globalThis.chrome?.runtime?.lastError;
          if (lastError) {
            resolve({ success: false, error: lastError.message });
            return;
          }
          resolve(response || { success: true });
        }
      );
    });
  }

  const btn = document.createElement("button");
  btn.textContent = "Limpiar cache";
  Object.assign(btn.style, {
    position: "fixed",
    top: "20px",
    right: "130px", // offset for the Probar IP button
    padding: "10px 15px",
    backgroundColor: "#2C3E50",
    color: "#FFF",
    border: "1px solid #34495E",
    borderRadius: "50px",
    fontSize: "12px",
    fontWeight: "bold",
    cursor: "pointer",
    boxShadow: "0 4px 10px rgba(0,0,0,0.5)",
    zIndex: "9999998",
    display: "none",
    alignItems: "center",
    gap: "5px",
    transition: "all 0.3s"
  });

  btn.onmouseover = () => { btn.style.transform = "scale(1.05)"; };
  btn.onmouseout = () => { btn.style.transform = "scale(1)"; };

  btn.onclick = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (btn.disabled) return;
    btn.textContent = "Limpiando...";
    btn.style.backgroundColor = "#f39c12";
    btn.disabled = true;

    try {
      await clearVisiblePageCache();
      const response = await requestChromeCacheClear();
      if (response?.success === false) throw new Error(response.error || "Error");
      btn.textContent = "Cache limpia";
      btn.style.backgroundColor = "#27ae60";
      setTimeout(() => window.location.reload(), 650);
    } catch (error) {
      btn.textContent = "Error al limpiar";
      btn.style.backgroundColor = "#e74c3c";
      setTimeout(() => {
        btn.textContent = "Limpiar cache";
        btn.style.backgroundColor = "#2C3E50";
        btn.disabled = false;
      }, 2000);
    }
  };

  const tryAppend = async () => {
    if (document.body && !document.getElementById("iamax-clear-cache-simple-btn")) {
      btn.id = "iamax-clear-cache-simple-btn";
      document.body.appendChild(btn);
    }
    const enabled = await isEnabled();
    btn.style.display = enabled ? "flex" : "none";
  };

  tryAppend();
  setInterval(tryAppend, 1000);
})();
