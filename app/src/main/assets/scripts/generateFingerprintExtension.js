const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

/**
 * Generates an MV3 extension on the fly to spoof hardware fingerprint.
 * @returns {string} The path to the generated extension folder.
 */
function generateFingerprintExtension() {
  try {
    const baseDir = app ? app.getPath('userData') : os.tmpdir();
    const extDir = path.join(baseDir, 'iamax-fingerprint-spoofer');

    if (!fs.existsSync(extDir)) {
      fs.mkdirSync(extDir, { recursive: true });
    }

    const manifestPath = path.join(extDir, 'manifest.json');
    const contentScriptPath = path.join(extDir, 'content.js');
    const injectScriptPath = path.join(extDir, 'inject.js');

    const manifestContent = {
      manifest_version: 3,
      name: "IAmax Hardware Spoofer",
      version: "1.0.0",
      description: "Estandariza la huella de hardware en todas las PCs.",
      content_scripts: [
        {
          matches: ["<all_urls>"],
          js: ["content.js"],
          run_at: "document_start",
          all_frames: true,
          match_about_blank: true
        }
      ],
      web_accessible_resources: [
        {
          resources: ["inject.js"],
          matches: ["<all_urls>"]
        }
      ]
    };

    const contentJs = `
      try {
        const s = document.createElement('script');
        s.src = chrome.runtime.getURL('inject.js');
        s.onload = function() { this.remove(); };
        (document.head || document.documentElement).appendChild(s);
      } catch (e) {}
    `;

    // Script to inject directly into the main world
    const injectJs = `
      (function() {
        try {
          if (window.__iamax_spoofed) return;
          window.__iamax_spoofed = true;

          const spoofedHardwareConcurrency = 8;
          const spoofedDeviceMemory = 8;
          const spoofedWidth = 1920;
          const spoofedHeight = 1080;

          const defineProp = (obj, prop, val) => {
            try {
              Object.defineProperty(obj, prop, { get: () => val, configurable: true });
            } catch (e) {}
          };

          if (window.navigator) {
            defineProp(window.navigator, 'hardwareConcurrency', spoofedHardwareConcurrency);
            defineProp(window.navigator, 'deviceMemory', spoofedDeviceMemory);
          }

          if (window.screen) {
            defineProp(window.screen, 'width', spoofedWidth);
            defineProp(window.screen, 'height', spoofedHeight);
            defineProp(window.screen, 'availWidth', spoofedWidth);
            defineProp(window.screen, 'availHeight', spoofedHeight - 40);
            defineProp(window.screen, 'colorDepth', 24);
            defineProp(window.screen, 'pixelDepth', 24);
          }
        } catch(e) {}
      })();
    `;

    fs.writeFileSync(manifestPath, JSON.stringify(manifestContent, null, 2), 'utf8');
    fs.writeFileSync(contentScriptPath, contentJs, 'utf8');
    fs.writeFileSync(injectScriptPath, injectJs, 'utf8');

    return extDir;
  } catch (error) {
    console.error('[Fingerprint] Failed to generate extension:', error);
    return null;
  }
}

module.exports = { generateFingerprintExtension };
