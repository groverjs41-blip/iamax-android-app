// spoof.js
// Script to standardize browser fingerprint to appear as a single computer

(function() {
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
  const spoofedHardwareConcurrency = 8;
  const spoofedDeviceMemory = 8;
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

  // Navigator spoofing
  if (window.navigator) {
    defineProperty(window.navigator, 'userAgent', spoofedUserAgent);
    defineProperty(window.navigator, 'appVersion', spoofedAppVersion);
    defineProperty(window.navigator, 'platform', spoofedPlatform);
    defineProperty(window.navigator, 'vendor', spoofedVendor);
    defineProperty(window.navigator, 'hardwareConcurrency', spoofedHardwareConcurrency);
    defineProperty(window.navigator, 'deviceMemory', spoofedDeviceMemory);
  }

  // Screen spoofing
  if (window.screen) {
    defineProperty(window.screen, 'width', spoofedWidth);
    defineProperty(window.screen, 'height', spoofedHeight);
    defineProperty(window.screen, 'availWidth', spoofedWidth);
    defineProperty(window.screen, 'availHeight', spoofedHeight - 40); // Simulate taskbar
    defineProperty(window.screen, 'colorDepth', 24);
    defineProperty(window.screen, 'pixelDepth', 24);
  }

  // WebGL spoofing (basic) to standardize graphics card fingerprint
  try {
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      // UNMASKED_VENDOR_WEBGL
      if (parameter === 37445) return "Google Inc. (NVIDIA)";
      // UNMASKED_RENDERER_WEBGL
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

})();
