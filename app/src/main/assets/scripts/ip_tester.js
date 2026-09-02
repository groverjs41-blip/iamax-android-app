/**
 * Botón flotante: verificar IP del proxy (sale por la red del perfil / proxy de la tarjeta).
 * Funciona en Chromium IAmax (fetch en página) y opcionalmente vía chrome.runtime CHECK_IP.
 */
(() => {
  if (window.self !== window.top) return;
  if (window.__iamaxIpTesterBooted) return;
  window.__iamaxIpTesterBooted = true;

  const ENDPOINTS = [
    { name: 'ipify', url: 'https://api.ipify.org?format=json', parse: (t) => JSON.parse(t).ip },
    { name: 'ipify-text', url: 'https://api.ipify.org', parse: (t) => String(t || '').trim() },
    { name: 'icanhazip', url: 'https://icanhazip.com', parse: (t) => String(t || '').trim() },
    { name: 'ifconfig', url: 'https://ifconfig.me/ip', parse: (t) => String(t || '').trim() }
  ];

  function getChromeRuntime() {
    return globalThis.iamaxChrome?.runtime || globalThis.chrome?.runtime || null;
  }

  async function fetchIpDirect() {
    let lastErr = '';
    for (const ep of ENDPOINTS) {
      try {
        const t0 = Date.now();
        const res = await fetch(ep.url, { cache: 'no-store', credentials: 'omit' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const ip = ep.parse(text);
        if (!ip || !/^\d{1,3}(\.\d{1,3}){3}$|^[0-9a-f:]+$/i.test(String(ip).trim())) {
          throw new Error('IP inválida');
        }
        return { ip: String(ip).trim(), latencyMs: Date.now() - t0, source: ep.name };
      } catch (e) {
        lastErr = e?.message || String(e);
      }
    }
    throw new Error(lastErr || 'No se pudo obtener IP');
  }

  function fetchIpViaRuntime() {
    return new Promise((resolve) => {
      const runtime = getChromeRuntime();
      if (!runtime?.sendMessage) {
        resolve(null);
        return;
      }
      const t0 = Date.now();
      try {
        runtime.sendMessage({ type: 'CHECK_IP' }, (res) => {
          const err = globalThis.chrome?.runtime?.lastError;
          if (err || !res?.ip) {
            resolve(null);
            return;
          }
          resolve({ ip: res.ip, latencyMs: Date.now() - t0, source: 'runtime' });
        });
      } catch {
        resolve(null);
      }
      setTimeout(() => resolve(null), 8000);
    });
  }

  const btn = document.createElement('button');
  btn.id = 'iamax-ip-tester';
  btn.type = 'button';
  btn.textContent = '🌐 Verificar IP';
  btn.title = 'Muestra la IP pública de este perfil (debe ser la del proxy si está activo)';
  Object.assign(btn.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    left: 'auto',
    top: 'auto',
    padding: '10px 14px',
    backgroundColor: '#0f766e',
    color: '#fff',
    border: '1px solid #115e59',
    borderRadius: '50px',
    fontSize: '12px',
    fontWeight: '700',
    cursor: 'pointer',
    boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
    zIndex: '2147483646',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontFamily: 'system-ui,Segoe UI,sans-serif',
    maxWidth: '92vw',
    whiteSpace: 'nowrap'
  });

  btn.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '🔄 Verificando IP…';
    btn.style.backgroundColor = '#d97706';

    try {
      // Preferir fetch en la página = IP real del proxy del perfil Chromium
      let result = null;
      try {
        result = await fetchIpDirect();
      } catch {
        result = await fetchIpViaRuntime();
      }
      if (!result?.ip) throw new Error('Sin respuesta');

      btn.textContent = `✅ IP: ${result.ip} · ${result.latencyMs}ms`;
      btn.style.backgroundColor = '#15803d';
      btn.title = `IP pública: ${result.ip}\nLatencia: ${result.latencyMs} ms\nFuente: ${result.source}\nSi hay proxy, esta IP debe ser la del proxy.`;
    } catch (e) {
      btn.textContent = '❌ Proxy/red falló';
      btn.style.backgroundColor = '#b91c1c';
      btn.title = e?.message || 'Error al verificar IP';
    }

    setTimeout(() => {
      btn.textContent = '🌐 Verificar IP';
      btn.style.backgroundColor = '#0f766e';
      btn.disabled = false;
    }, 8000);
  });

  const tryAppend = () => {
    if (!document.body) return;
    if (!document.getElementById('iamax-ip-tester')) {
      document.body.appendChild(btn);
    }
  };
  tryAppend();
  setInterval(tryAppend, 1500);
})();
