(() => {
// Streaming AdBlocker
// Remueve overlays, popups invisibles y banners molestos en sitios de streaming.

function runAdBlocker() {
  // Lista de selectores CSS comunes para ads y popups
  const selectors = [
    'iframe[src*="ads"]',
    'iframe[src*="pop"]',
    'iframe[src*="bet"]',
    'iframe[src*="casino"]',
    '.ad-container',
    '.ad-banner',
    '#popup-container',
    '[id*="pop-up"]',
    '[class*="pop-up"]',
    '[class*="adsbygoogle"]',
    '[class*="mgbox"]',
    '[id*="ad-"]',
    '[class*="ad-"]',
    '[class*="-ad-"]',
    '.video-ad',
    '.ima-ad-container',
    '[id*="ima-"]',
    '.jw-ad',
    '.vjs-ad',
    'a[href*="bet"]',
    'a[href*="casino"]'
  ];

  selectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      try {
        el.remove();
      } catch (e) {}
    });
  });

  // Prevenir que se abran nuevas pestañas (Popups invisibles de clic)
  window.open = function() {
    console.log("IAmax Adblocker previno una ventana emergente (popup).");
    return null;
  };

  // Deshabilitar overlays invisibles que roban el primer clic (típico en Pelota Libre)
  document.querySelectorAll('div, a').forEach(el => {
    const style = window.getComputedStyle(el);
    if (style.position === 'absolute' || style.position === 'fixed') {
      // Overlays con z-index alto que son transparentes
      if (parseInt(style.zIndex, 10) > 99 && (style.opacity === '0' || style.opacity === '0.01' || style.backgroundColor === 'rgba(0, 0, 0, 0)' || style.backgroundColor === 'transparent')) {
        // Solo remover si ocupan una porción grande de la pantalla (evitar romper menús legítimos)
        const rect = el.getBoundingClientRect();
        if (rect.width > 200 && rect.height > 200) {
           el.remove();
        }
      }
    }
  });

  // Intentar bloquear el popup listener a nivel del document (Clickjacking)
  document.onclick = function(e) {
    // Algunos sitios escuchan document.onclick para abrir popups
  };
}

// Ejecutar rápido al cargar
runAdBlocker();

// Ejecutar periódicamente porque algunos sitios recrean los anuncios
setInterval(runAdBlocker, 2000);

// Escuchar cambios en el DOM para bloquear instantáneamente nuevos anuncios
const observer = new MutationObserver((mutations) => {
  runAdBlocker();
});

observer.observe((document.documentElement || document), {
  childList: true,
  subtree: true
});

console.log("IAmax Streaming AdBlocker activado.");

})();
