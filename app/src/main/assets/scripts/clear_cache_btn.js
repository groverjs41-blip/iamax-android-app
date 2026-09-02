// Floating same-site cache cleaner — arrastrable (posición guardada).
(async function() {
  if (window.self !== window.top) return;
  if (window.__iamaxClearCacheBtnBooted) return;
  window.__iamaxClearCacheBtnBooted = true;

  const POS_KEY = 'iamax_clear_cache_btn_pos';

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
    if (globalThis.__iamaxClearCacheButtonEnabled === true) return true;
    if (globalThis.iamaxProfileFlags?.clearCacheButton === true) return true;
    return Boolean(await getStorageValue('pendingClearCacheBtn'));
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
          type: 'CLEAR_DOMAIN_CACHE_NO_COOKIES',
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

  function loadSavedPos() {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (typeof p.left === 'number' && typeof p.top === 'number') return p;
    } catch (e) {}
    return null;
  }

  function savePos(left, top) {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ left, top }));
    } catch (e) {}
  }

  function clampPos(left, top, el) {
    const w = el.offsetWidth || 120;
    const h = el.offsetHeight || 40;
    const maxL = Math.max(0, window.innerWidth - w - 4);
    const maxT = Math.max(0, window.innerHeight - h - 4);
    return {
      left: Math.min(maxL, Math.max(0, left)),
      top: Math.min(maxT, Math.max(0, top))
    };
  }

  function applyPos(el, left, top) {
    const c = clampPos(left, top, el);
    el.style.left = c.left + 'px';
    el.style.top = c.top + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    return c;
  }

  const btn = document.createElement('button');
  btn.id = 'iamax-clear-cache-simple-btn';
  btn.type = 'button';
  btn.textContent = 'Limpiar cache';
  btn.title = 'Arrastra para mover · Clic para limpiar cache';
  Object.assign(btn.style, {
    position: 'fixed',
    top: '16px',
    right: '16px',
    left: 'auto',
    padding: '10px 15px',
    backgroundColor: '#2C3E50',
    color: '#FFF',
    border: '1px solid #34495E',
    borderRadius: '50px',
    fontSize: '12px',
    fontWeight: 'bold',
    cursor: 'grab',
    boxShadow: '0 4px 10px rgba(0,0,0,0.5)',
    zIndex: '2147483646',
    display: 'none',
    alignItems: 'center',
    gap: '5px',
    userSelect: 'none',
    touchAction: 'none',
    transition: 'background-color 0.2s, box-shadow 0.2s'
  });

  // Restaurar posición guardada
  const saved = loadSavedPos();
  if (saved) {
    btn.style.right = 'auto';
    btn.style.left = saved.left + 'px';
    btn.style.top = saved.top + 'px';
  }

  // ——— Drag ———
  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let origLeft = 0;
  let origTop = 0;
  const DRAG_THRESHOLD = 5;

  function onPointerDown(e) {
    if (btn.disabled) return;
    if (e.button != null && e.button !== 0) return;
    dragging = true;
    moved = false;
    const rect = btn.getBoundingClientRect();
    origLeft = rect.left;
    origTop = rect.top;
    startX = e.clientX;
    startY = e.clientY;
    btn.style.cursor = 'grabbing';
    btn.style.transition = 'none';
    btn.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    moved = true;
    applyPos(btn, origLeft + dx, origTop + dy);
  }

  function onPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    btn.style.cursor = 'grab';
    btn.style.transition = 'background-color 0.2s, box-shadow 0.2s';
    try { btn.releasePointerCapture?.(e.pointerId); } catch (err) {}
    if (moved) {
      const rect = btn.getBoundingClientRect();
      const c = applyPos(btn, rect.left, rect.top);
      savePos(c.left, c.top);
      // Evitar click después de arrastrar
      btn.__iamaxSkipClick = true;
      setTimeout(() => { btn.__iamaxSkipClick = false; }, 50);
    }
  }

  btn.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('resize', () => {
    const rect = btn.getBoundingClientRect();
    if (btn.style.display !== 'none') {
      const c = applyPos(btn, rect.left, rect.top);
      savePos(c.left, c.top);
    }
  });

  btn.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (btn.__iamaxSkipClick || moved) {
      moved = false;
      return;
    }
    if (btn.disabled) return;
    btn.textContent = 'Limpiando...';
    btn.style.backgroundColor = '#f39c12';
    btn.disabled = true;
    btn.style.cursor = 'wait';

    try {
      await clearVisiblePageCache();
      const response = await requestChromeCacheClear();
      if (response?.success === false) throw new Error(response.error || 'Error');
      btn.textContent = 'Cache limpia';
      btn.style.backgroundColor = '#27ae60';
      setTimeout(() => window.location.reload(), 650);
    } catch (error) {
      btn.textContent = 'Error al limpiar';
      btn.style.backgroundColor = '#e74c3c';
      setTimeout(() => {
        btn.textContent = 'Limpiar cache';
        btn.style.backgroundColor = '#2C3E50';
        btn.disabled = false;
        btn.style.cursor = 'grab';
      }, 2000);
    }
  });

  // Doble clic = reset posición esquina
  btn.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { localStorage.removeItem(POS_KEY); } catch (err) {}
    btn.style.left = 'auto';
    btn.style.top = '16px';
    btn.style.right = '16px';
  });

  const tryAppend = async () => {
    if (document.body && !document.getElementById('iamax-clear-cache-simple-btn')) {
      document.body.appendChild(btn);
      // Re-aplicar posición tras montar (offsetWidth ya disponible)
      const pos = loadSavedPos();
      if (pos) applyPos(btn, pos.left, pos.top);
    }
    const enabled = await isEnabled();
    btn.style.display = enabled ? 'flex' : 'none';
  };

  tryAppend();
  setInterval(tryAppend, 1000);
})();
