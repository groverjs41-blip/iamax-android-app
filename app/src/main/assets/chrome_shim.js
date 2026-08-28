/**
 * IAmax Chrome API Shim for Android WebView
 * Translates chrome.* extension APIs to native AndroidBridge calls.
 */
(function() {
  if (typeof window === "undefined") return;

  const bridge = window.AndroidBridge;

  function callBridge(msg) {
    if (!bridge) {
      console.warn("[IAmax Shim] AndroidBridge is not available yet.", msg);
      return { success: false, error: "Bridge unavailable" };
    }
    try {
      const respStr = bridge.handleMessage(JSON.stringify(msg));
      return JSON.parse(respStr || "{}");
    } catch (err) {
      console.error("[IAmax Shim] Bridge call failed:", err, msg);
      return { success: false, error: err.message };
    }
  }

  // Native HTTP Fetch Polyfill for Android (Bypasses all CORS, Preflight and Mixed Content restrictions)
  const _originalFetch = window.fetch.bind(window);

  window.fetch = async function(resource, init = {}) {
    const url = typeof resource === "string" ? resource : (resource ? resource.url : "");

    if (bridge && typeof bridge.nativeFetch === "function" && (url.startsWith("http://") || url.startsWith("https://"))) {
      try {
        const method = (init.method || "GET").toUpperCase();
        const headers = init.headers || {};
        const headersObj = {};

        if (headers instanceof Headers) {
          headers.forEach((v, k) => { headersObj[k] = v; });
        } else if (Array.isArray(headers)) {
          headers.forEach(([k, v]) => { headersObj[k] = v; });
        } else if (typeof headers === "object") {
          Object.assign(headersObj, headers);
        }

        const body = typeof init.body === "string" ? init.body : (init.body ? JSON.stringify(init.body) : "");

        const respObj = await new Promise((resolve) => {
          const cbName = "_iamax_native_fetch_cb_" + Math.random().toString(36).substring(2) + Date.now();
          window[cbName] = function(responsePayload) {
            delete window[cbName];
            resolve(responsePayload);
          };
          bridge.nativeFetch(url, method, JSON.stringify(headersObj), body, cbName);
        });

        const status = respObj.status || 200;
        const statusText = respObj.statusText || (status >= 200 && status < 300 ? "OK" : "Error");
        const respHeaders = new Headers(respObj.headers || {});
        const responseBody = respObj.body || "";

        return new Response(responseBody, {
          status: status,
          statusText: statusText,
          headers: respHeaders
        });
      } catch (err) {
        console.warn("[IAmax Shim] nativeFetch failed, fallback to standard fetch:", err);
        return _originalFetch(resource, init);
      }
    }

    return _originalFetch(resource, init);
  };

  // Define window.chrome shim
  window.chrome = window.chrome || {};

  window.chrome.runtime = {
    id: "iamax-android-launcher",
    lastError: null,
    getManifest: function() {
      return {
        name: "IAmax Launcher",
        version: "1.3.8",
        manifest_version: 3,
        description: "Dashboard visual de herramientas IA con admin seguro en backend."
      };
    },
    getURL: function(path) {
      if (!path) return "https://appassets.androidplatform.net/assets/";
      if (path.startsWith("/")) path = path.substring(1);
      return "https://appassets.androidplatform.net/assets/" + path;
    },
    sendMessage: function(msg, callback) {
      const resp = callBridge(msg);
      window.chrome.runtime.lastError = null;
      if (typeof callback === "function") {
        setTimeout(function() {
          callback(resp);
        }, 0);
      }
      return Promise.resolve(resp);
    },
    onMessage: {
      addListener: function(fn) {},
      removeListener: function(fn) {}
    },
    onInstalled: {
      addListener: function(fn) {}
    },
    onStartup: {
      addListener: function(fn) {}
    }
  };

  window.chrome.extension = {
    isAllowedIncognitoAccess: function(callback) {
      window.chrome.runtime.lastError = null;
      if (typeof callback === "function") callback(true);
      return Promise.resolve(true);
    }
  };

  window.chrome.action = {
    setBadgeText: function() {},
    setBadgeBackgroundColor: function() {},
    onClicked: { addListener: function() {} }
  };

  window.chrome.windows = {
    create: function(createData, callback) {
      const url = createData ? createData.url : "";
      if (url) {
        callBridge({ type: "OPEN_TOOL", url: url });
      }
      const win = { id: 1, focused: true };
      if (typeof callback === "function") callback(win);
      return Promise.resolve(win);
    },
    update: function(winId, updateInfo, callback) {
      const win = { id: winId || 1 };
      if (typeof callback === "function") callback(win);
      return Promise.resolve(win);
    },
    remove: function(winId, callback) {
      if (typeof callback === "function") callback();
      return Promise.resolve();
    }
  };

  window.chrome.cookies = {
    get: function(details, callback) {
      if (typeof callback === "function") callback(null);
      return Promise.resolve(null);
    },
    getAll: function(details, callback) {
      const cookiesResp = callBridge({ type: "EXTRACT_SESSION", url: details?.url || details?.domain || "" });
      const cookies = cookiesResp?.cookies || [];
      if (typeof callback === "function") callback(cookies);
      return Promise.resolve(cookies);
    },
    set: function(details, callback) {
      if (typeof callback === "function") callback(details);
      return Promise.resolve(details);
    },
    remove: function(details, callback) {
      if (typeof callback === "function") callback(details);
      return Promise.resolve(details);
    },
    getAllCookieStores: function(callback) {
      const stores = [{ id: "0", tabIds: [1] }];
      if (typeof callback === "function") callback(stores);
      return Promise.resolve(stores);
    }
  };

  window.chrome.scripting = {
    executeScript: function(injection, callback) {
      const res = [{ result: true }];
      if (typeof callback === "function") callback(res);
      return Promise.resolve(res);
    }
  };

  window.chrome.declarativeNetRequest = {
    updateDynamicRules: function(options, callback) {
      if (typeof callback === "function") callback();
      return Promise.resolve();
    },
    getDynamicRules: function(callback) {
      const rules = [];
      if (typeof callback === "function") callback(rules);
      return Promise.resolve(rules);
    }
  };

  // Storage shim: connects directly to Android SharedPreferences
  const storageEngine = {
    get: function(keys, callback) {
      return new Promise(function(resolve) {
        const result = {};
        if (typeof keys === "string") {
          const val = bridge ? bridge.getStoredItem(keys) : localStorage.getItem(keys);
          if (val) {
            try { result[keys] = JSON.parse(val); } catch(e) { result[keys] = val; }
          }
        } else if (Array.isArray(keys)) {
          keys.forEach(function(k) {
            const val = bridge ? bridge.getStoredItem(k) : localStorage.getItem(k);
            if (val) {
              try { result[k] = JSON.parse(val); } catch(e) { result[k] = val; }
            }
          });
        } else if (keys === null || typeof keys === "undefined") {
          const allResp = callBridge({ type: "GET_ALL_STORAGE" });
          Object.assign(result, allResp.data || {});
        } else if (typeof keys === "object") {
          Object.keys(keys).forEach(function(k) {
            const val = bridge ? bridge.getStoredItem(k) : localStorage.getItem(k);
            if (val) {
              try { result[k] = JSON.parse(val); } catch(e) { result[k] = val; }
            } else {
              result[k] = keys[k];
            }
          });
        }

        if (typeof callback === "function") callback(result);
        resolve(result);
      });
    },
    set: function(items, callback) {
      return new Promise(function(resolve) {
        if (items && typeof items === "object") {
          Object.keys(items).forEach(function(k) {
            const val = typeof items[k] === "string" ? items[k] : JSON.stringify(items[k]);
            if (bridge) {
              bridge.setStoredItem(k, val);
            } else {
              localStorage.setItem(k, val);
            }
          });
        }
        if (typeof callback === "function") callback();
        resolve();
      });
    },
    remove: function(keys, callback) {
      return new Promise(function(resolve) {
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(function(k) {
          if (bridge) {
            bridge.removeStoredItem(k);
          } else {
            localStorage.removeItem(k);
          }
        });
        if (typeof callback === "function") callback();
        resolve();
      });
    },
    clear: function(callback) {
      return new Promise(function(resolve) {
        if (typeof callback === "function") callback();
        resolve();
      });
    }
  };

  window.chrome.storage = {
    local: storageEngine,
    session: storageEngine,
    sync: storageEngine
  };

  window.chrome.tabs = {
    get: function(tabId, callback) {
      const tab = { id: tabId || 1, url: window.location.href, status: "complete" };
      if (typeof callback === "function") callback(tab);
      return Promise.resolve(tab);
    },
    create: function(createProperties, callback) {
      const url = createProperties ? createProperties.url : "";
      if (url) {
        callBridge({ type: "OPEN_TOOL", url: url });
      }
      if (typeof callback === "function") callback({ id: 1, url: url });
      return Promise.resolve({ id: 1, url: url });
    },
    query: function(queryInfo, callback) {
      const fakeTab = [{ id: 1, url: window.location.href, active: true }];
      if (typeof callback === "function") callback(fakeTab);
      return Promise.resolve(fakeTab);
    },
    update: function(tabId, updateProps, callback) {
      if (updateProps && updateProps.url) {
        callBridge({ type: "OPEN_TOOL", url: updateProps.url });
      }
      if (typeof callback === "function") callback({ id: 1 });
      return Promise.resolve({ id: 1 });
    },
    remove: function(tabId, callback) {
      if (typeof callback === "function") callback();
      return Promise.resolve();
    },
    onUpdated: {
      addListener: function(fn) {},
      removeListener: function(fn) {}
    }
  };

  // Fallback loader auto-hide after 2.5 seconds to prevent frozen overlay
  document.addEventListener("DOMContentLoaded", function() {
    setTimeout(function() {
      const loader = document.getElementById("extensionLoadingScreen");
      if (loader && !loader.classList.contains("is-leaving")) {
        console.log("[IAmax Shim] Auto-clearing loading overlay...");
        loader.classList.add("is-leaving");
      }
    }, 2500);
  });

  console.log("[IAmax Shim] Chrome API Shim & Native Fetch initialized successfully for Android.");
})();
