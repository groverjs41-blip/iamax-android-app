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

  // Define window.chrome shim
  window.chrome = window.chrome || {};

  window.chrome.runtime = {
    id: "iamax-android-launcher",
    lastError: null,
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

  console.log("[IAmax Shim] Chrome API Shim initialized successfully for Android.");
})();
