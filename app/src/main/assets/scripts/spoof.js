// spoof.js
// Fingerprint spoofing controlado por tarjeta desde el servidor.
// Lee 'spoofEnabled' desde chrome.storage.session (guardado al abrir la tarjeta).

(function() {

  function applySpoofing() {
    try {
      if (localStorage.getItem("__iamax_skip_spoof__") === "1") {
        localStorage.removeItem("__iamax_skip_spoof__");
        return;
      }
    } catch (e) {}

    const spoofedUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    const spoofedAppVersion = "120.0.0.0";
    const spoofedPlatform = "Win32";
    const spoofedVendor = "Google Inc.";
    const spoofedHardwareConcurrency = 4;
    const spoofedDeviceMemory = 4;
    const spoofedWidth = 1920;
    const spoofedHeight = 1080;

    const defineProperty = (object, property, value) => {
      try {
        Object.defineProperty(object, property, {
          get: () => value,
          configurable: true
        });
      } catch (e) {}
    };

    if (window.navigator) {
      defineProperty(window.navigator, 'userAgent', spoofedUserAgent);
      defineProperty(window.navigator, 'appVersion', spoofedAppVersion);
      defineProperty(window.navigator, 'platform', spoofedPlatform);
      defineProperty(window.navigator, 'vendor', spoofedVendor);
      defineProperty(window.navigator, 'hardwareConcurrency', spoofedHardwareConcurrency);
      defineProperty(window.navigator, 'deviceMemory', spoofedDeviceMemory);
    }

    if (window.screen) {
      defineProperty(window.screen, 'width', spoofedWidth);
      defineProperty(window.screen, 'height', spoofedHeight);
      defineProperty(window.screen, 'availWidth', spoofedWidth);
      defineProperty(window.screen, 'availHeight', spoofedHeight - 40);
      defineProperty(window.screen, 'colorDepth', 24);
      defineProperty(window.screen, 'pixelDepth', 24);
    }

    try {
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) return "Google Inc. (NVIDIA)";
        if (parameter === 37446) return "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)";
        return getParameter.apply(this, arguments);
      };
      const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) return "Google Inc. (NVIDIA)";
        if (parameter === 37446) return "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)";
        return getParameter2.apply(this, arguments);
      };
    } catch (e) {}
  }

  // Leer spoofEnabled desde session storage (guardado al abrir la tarjeta desde el dashboard)
  try {
    const sessionApi = chrome.storage.session;
    if (!sessionApi) {
      chrome.storage.local.get("spoofEnabled", function(res) {
        if (res.spoofEnabled === true) applySpoofing();
      });
    } else {
      sessionApi.get("spoofEnabled", function(res) {
        if (res.spoofEnabled === true) applySpoofing();
      });
    }
  } catch(e) {}

})();
