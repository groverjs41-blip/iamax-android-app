importScripts("modules/catalog.js", "modules/manager.js");

const DEFAULT_API_BASE = "http://2.24.116.152";
const API_OVERRIDE_KEY = "apiBaseUrl";

async function ensureLocalPrefs() {
  await chrome.storage.local.remove(API_OVERRIDE_KEY);
}
chrome.runtime.onInstalled.addListener((details) => {
  void handleInstall(details);
});

chrome.runtime.onStartup.addListener(() => {
  void ensureLocalPrefs();
});

chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({
    url: chrome.runtime.getURL("dashboard/index.html")
  });
});

// MAPA DE RASTREO EN VIVO PARA PC
const activeTracking = new Map(); // tabId -> cardId
const sessionRevisionByCard = new Map();
const sessionSyncTimers = new Map();
let apiBaseUrlFallback = DEFAULT_API_BASE;
const PRESENCE_ALARM = "iamax-profile-presence";
const SESSION_SYNC_ALARM = "iamax-session-cloud-sync";
const EXTENSION_ORIGIN = chrome.runtime.getURL("");

const DASHBOARD_ONLY_MESSAGE_TYPES = new Set([
  "SET_BLOCKED_SELECTORS",
  "INJECT_CREDENTIALS",
  "INJECT_SESSION",
  "EXTRACT_SESSION",
  "CLEAR_AND_OPEN",
  "SET_PROFILE_MODULES",
  "REVOKE_ACCESS_STATE"
]);

const CONTENT_SCRIPT_MESSAGE_TYPES = new Set([
  "AUTO_INJECT_NOW",
  "GET_PENDING_INJECT_STATE",
  "RELOAD_INCOGNITO",
  "CLEAR_DOMAIN_CACHE_NO_COOKIES",
  "CLEAR_DOMAIN_CACHE",
  "DOWNLOAD_GROK_ASSET",
  "OPEN_TOOL_WINDOW",
  "GET_PROFILE_MODULES"
]);

function isExtensionPage(sender = {}) {
  return Boolean(
    sender.id === chrome.runtime.id &&
    typeof sender.url === "string" &&
    sender.url.startsWith(EXTENSION_ORIGIN)
  );
}

function isTrustedContentScript(sender = {}) {
  return Boolean(
    sender.id === chrome.runtime.id &&
    sender.tab &&
    typeof sender.url === "string" &&
    (sender.url.startsWith("https://") || sender.url.startsWith("http://"))
  );
}

function isAllowedMessageSender(type, sender = {}, message = {}) {
  if (DASHBOARD_ONLY_MESSAGE_TYPES.has(type)) {
    return isExtensionPage(sender);
  }

  if (!CONTENT_SCRIPT_MESSAGE_TYPES.has(type)) {
    return false;
  }

  if (!isExtensionPage(sender) && !isTrustedContentScript(sender)) {
    return false;
  }

  if (type === "DOWNLOAD_GROK_ASSET") {
    return String(sender.tab?.url || sender.url || message.url || "").includes("grok.com");
  }

  if (type === "OPEN_TOOL_WINDOW") {
    const sourceUrl = String(sender.tab?.url || sender.url || message.url || "");
    return isExtensionPage(sender) || sourceUrl.includes("gemini.google.com");
  }

  if (type === "RELOAD_INCOGNITO") {
    return Boolean(sender.tab);
  }

  return true;
}

function sanitizeCssSelector(selector = "") {
  const trimmed = String(selector || "").trim();
  if (!trimmed || trimmed.length > 200) return "";
  if (/[{};@]/.test(trimmed) || /url\s*\(/i.test(trimmed)) return "";
  return trimmed;
}

function splitBlockedSelectors(raw = "") {
  const rawSelectors = String(raw || "").split(",").map((entry) => entry.trim()).filter(Boolean);
  const cssSelectors = rawSelectors
    .filter((entry) => !entry.toLowerCase().startsWith("text:"))
    .map(sanitizeCssSelector)
    .filter(Boolean);
  const textSelectors = rawSelectors
    .filter((entry) => entry.toLowerCase().startsWith("text:"))
    .map((entry) => entry.substring(5).trim().toLowerCase())
    .filter((entry) => entry && entry.length <= 120 && !/[<>]/.test(entry));
  return { cssSelectors, textSelectors };
}

function sanitizeBlockedDomain(domain = "") {
  const normalized = String(domain || "").trim().toLowerCase().slice(0, 120);
  if (!normalized || /[\s/\\]/.test(normalized)) return "";
  return normalized;
}

async function getApiBase() {
  await chrome.storage.local.remove(API_OVERRIDE_KEY);
  return apiBaseUrlFallback;
}

async function getPresenceClientId() {
  const stored = await chrome.storage.local.get(["deviceId", "presenceClientId"]);
  const clientId = stored.deviceId || stored.presenceClientId
    || `ext_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  if (!stored.deviceId && !stored.presenceClientId) {
    await chrome.storage.local.set({ presenceClientId: clientId });
  }
  return clientId;
}

async function sendPresence(cardId, action = "ping") {
  if (!cardId) return;
  const clientId = await getPresenceClientId();
  await fetchWithBackgroundAuth(`/api/public/tracking/${action}/${cardId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, platform: "extension" })
  }).catch(() => {});
}

async function persistActiveTracking() {
  await chrome.storage.session.set({ activeProfileTabs: Object.fromEntries(activeTracking) }).catch(() => {});
}

function scheduleTrackedSessionSync(tabId, delayMs = 30000) {
  if (!Number.isInteger(tabId)) return;
  const previous = sessionSyncTimers.get(tabId);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(() => {
    sessionSyncTimers.delete(tabId);
    void syncTrackedTabSession(tabId);
  }, Math.max(1000, Number(delayMs) || 30000));
  sessionSyncTimers.set(tabId, timer);
}

async function extractTrackedTabSession(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url || !/^https?:/i.test(tab.url)) return null;
  const hostname = new URL(tab.url).hostname.replace(/^www\./, "");
  const cookieMap = new Map();
  for (const domain of getSessionDomains(hostname)) {
    const cookies = await chrome.cookies.getAll({ domain }).catch(() => []);
    for (const cookie of cookies) {
      const key = `${cookie.storeId || "0"}|${cookie.partitionKey?.topLevelSite || ""}|${cookie.domain}|${cookie.path}|${cookie.name}`;
      cookieMap.set(key, cookie);
    }
  }
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const local = {};
      const session = {};
      try {
        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i);
          local[key] = localStorage.getItem(key);
        }
      } catch (error) {}
      try {
        for (let i = 0; i < sessionStorage.length; i += 1) {
          const key = sessionStorage.key(i);
          session[key] = sessionStorage.getItem(key);
        }
      } catch (error) {}
      return { local, session };
    }
  }).catch(() => []);
  const storage = results?.[0]?.result || { local: {}, session: {} };
  const cookies = [...cookieMap.values()];
  if (!cookies.some((cookie) => cookie?.name && cookie?.value)) return null;
  return {
    cookies_json: JSON.stringify(cookies),
    local_storage_json: JSON.stringify(storage.local || {}),
    session_storage_json: JSON.stringify(storage.session || {}),
    indexed_db_json: "{}"
  };
}

async function downloadTrackedCloudSession(cardId) {
  const result = await fetchWithBackgroundAuth(
    `/api/sessions/download/${encodeURIComponent(cardId)}`
  );
  if (!result.response?.ok) return null;
  const payload = result.payload;
  if (payload?.revision) sessionRevisionByCard.set(String(cardId), String(payload.revision));
  return payload;
}

async function syncTrackedTabSession(tabId, retry = true) {
  const cardId = activeTracking.get(tabId);
  if (cardId === undefined || cardId === null) return;
  const live = await extractTrackedTabSession(tabId);
  if (!live) return;
  const cloud = await downloadTrackedCloudSession(cardId).catch(() => null);
  const result = await fetchWithBackgroundAuth(`/api/sessions/upload/${encodeURIComponent(cardId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...live,
      indexed_db_json: cloud?.indexed_db_json || live.indexed_db_json,
      expected_revision: sessionRevisionByCard.get(String(cardId)) || cloud?.revision || null,
      source_device_id: "extension"
    })
  });
  const response = result.response;
  const payload = result.payload || {};
  if (response?.status === 409 && retry) {
    if (payload?.current_revision) sessionRevisionByCard.set(String(cardId), String(payload.current_revision));
    await downloadTrackedCloudSession(cardId).catch(() => null);
    return syncTrackedTabSession(tabId, false);
  }
  if (!response?.ok) {
    console.warn(`[IAMAX] No se pudo renovar la sesion card=${cardId}:`, payload?.error || response?.status || "sin conexion");
    return;
  }
  if (payload?.revision) sessionRevisionByCard.set(String(cardId), String(payload.revision));
}

async function sendActivePresencePings() {
  if (activeTracking.size === 0) return;
  const cardIds = new Set(activeTracking.values());
  await Promise.all([...cardIds].map((cardId) => sendPresence(cardId)));
}

async function restoreActiveTracking() {
  const stored = await chrome.storage.session.get("activeProfileTabs").catch(() => ({}));
  const entries = Object.entries(stored.activeProfileTabs || {});
  const tabs = await chrome.tabs.query({});
  const openTabIds = new Set(tabs.map((tab) => tab.id));
  entries.forEach(([tabId, cardId]) => {
    const numericTabId = Number(tabId);
    if (openTabIds.has(numericTabId)) activeTracking.set(numericTabId, cardId);
  });
  await persistActiveTracking();
  await sendActivePresencePings();
}

setInterval(() => void sendActivePresencePings(), 10000);
chrome.alarms.create(PRESENCE_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.create(SESSION_SYNC_ALARM, { periodInMinutes: 3 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PRESENCE_ALARM) void sendActivePresencePings();
  if (alarm.name === SESSION_SYNC_ALARM) {
    for (const tabId of activeTracking.keys()) void syncTrackedTabSession(tabId);
  }
});
void restoreActiveTracking();

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const syncTimer = sessionSyncTimers.get(tabId);
  if (syncTimer) clearTimeout(syncTimer);
  sessionSyncTimers.delete(tabId);
  if (activeTracking.has(tabId)) {
    const cardId = activeTracking.get(tabId);
    activeTracking.delete(tabId);
    await persistActiveTracking();
    const cardStillOpen = [...activeTracking.values()].some((activeCardId) => String(activeCardId) === String(cardId));
    if (!cardStillOpen) void sendPresence(cardId, "leave");
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && activeTracking.has(tabId)) {
    scheduleTrackedSessionSync(tabId, 20000);
  }
  if (changeInfo.status === 'loading' && tab.url && tab.url.startsWith('http')) {
    try {
      const res = await chrome.storage.local.get("blockedSelectors");
      if (res.blockedSelectors) {
        const urlObj = new URL(tab.url);
        const domain = urlObj.hostname;
        
        for (const key of Object.keys(res.blockedSelectors)) {
           if (domain.includes(key) && res.blockedSelectors[key]) {
              const { cssSelectors, textSelectors } = splitBlockedSelectors(res.blockedSelectors[key]);
              
              if (cssSelectors.length > 0) {
                 await chrome.scripting.insertCSS({
                    target: { tabId },
                    css: `${cssSelectors.join(', ')} { display: none !important; pointer-events: none !important; opacity: 0 !important; visibility: hidden !important; z-index: -9999 !important; }`
                 }).catch(()=>{});
              }

              if (textSelectors.length > 0) {
                 await chrome.scripting.executeScript({
                    target: { tabId },
                    func: (texts) => {
                       const hideElements = () => {
                          const root = document.body || document.documentElement;
                          if (!root) return;
                          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
                          let node;
                          while (node = walker.nextNode()) {
                             const text = node.nodeValue.trim().toLowerCase();
                             if (text && texts.includes(text)) {
                                 const parent = node.parentElement;
                                 if (parent && parent.tagName !== 'SCRIPT' && parent.tagName !== 'STYLE') {
                                     const container = parent.closest('a, button, li, [role="menuitem"], [role="button"]') || parent;
                                     container.style.setProperty('display', 'none', 'important');
                                     container.style.setProperty('opacity', '0', 'important');
                                     container.style.setProperty('pointer-events', 'none', 'important');
                                 }
                             }
                          }
                       };
                       const initObserver = () => {
                          const root = document.body || document.documentElement;
                          if (!root) {
                              setTimeout(initObserver, 100);
                              return;
                          }
                          hideElements();
                          const observer = new MutationObserver(() => hideElements());
                          observer.observe(root, { childList: true, subtree: true, characterData: true });
                       };
                       initObserver();
                    },
                    args: [textSelectors]
                 }).catch(()=>{});
              }
           }
        }
      }
    } catch(e) {}
  }
});

async function handleInstall(details) {
  await ensureLocalPrefs();

  await chrome.tabs.create({
    url: chrome.runtime.getURL("dashboard/index.html")
  });

  if (details.reason === "install") {
    // La extensión ya está configurada con el servidor de producción.
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const messageType = message?.type;
  if (!messageType) return;

  if (!isAllowedMessageSender(messageType, sender, message)) {
    sendResponse({ success: false, error: "Origen no autorizado" });
    return true;
  }

  if (messageType === "REVOKE_ACCESS_STATE") {
    revokeExtensionAccess(message.reason || "LOGOUT")
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (messageType === "SET_PROFILE_MODULES") {
    globalThis.iamaxModuleManager.configureCard(message.cardId, message.modules)
      .then((modules) => sendResponse({ success: true, modules }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (messageType === "GET_PROFILE_MODULES") {
    const tabId = sender.tab?.id;
    const cardId = Number.isInteger(tabId) ? activeTracking.get(tabId) : null;
    if (cardId === undefined || cardId === null) {
      sendResponse({ success: true, managed: false, modules: [] });
      return true;
    }
    globalThis.iamaxModuleManager.getForCard(cardId)
      .then((modules) => sendResponse({ success: true, managed: true, cardId, modules }))
      .catch((error) => sendResponse({ success: false, managed: true, modules: [], error: error.message }));
    return true;
  }
  if (messageType === "GET_PENDING_INJECT_STATE") {
    getSessionValues(["pendingInjectCardId", "clientInjectMethod", "clientCanInject", "isOwner"])
      .then((values) => {
        const trackedCardId = Number.isInteger(sender.tab?.id)
          ? activeTracking.get(sender.tab.id)
          : null;
        const method = String(values.clientInjectMethod || "").trim().toLowerCase();
        const allowed = values.isOwner === true || values.clientCanInject === true;
        const effectiveCardId = values.pendingInjectCardId
          || (allowed && method === "google" ? trackedCardId : null);
        sendResponse({ success: true, ...values, pendingInjectCardId: effectiveCardId || null });
      })
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (messageType === "SET_BLOCKED_SELECTORS") {
    const domain = sanitizeBlockedDomain(message.domain);
    if (!domain) {
      sendResponse({ success: false, error: "Dominio invalido" });
      return true;
    }
    chrome.storage.local.get("blockedSelectors").then((res) => {
       const blocked = res.blockedSelectors || {};
       blocked[domain] = String(message.selectors || "").slice(0, 2000);
       chrome.storage.local.set({ blockedSelectors: blocked });
       sendResponse({ success: true });
    });
    return true;
  }
  if (messageType === "INJECT_CREDENTIALS") {
    requireLiveAccess(message.cardId)
      .then((access) => access.ok
        ? handleInjectCredentials(message.email, message.password, message.totpCode)
        : { success: false, error: access.error, code: access.code })
      .then((res) => sendResponse(res))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (messageType === "INJECT_SESSION") {
    requireLiveAccess(message.cardId)
      .then((access) => {
        if (!access.ok) return { success: false, error: access.error, code: access.code };
        if (message.cardId && message.sessionData?.revision) {
          sessionRevisionByCard.set(String(message.cardId), String(message.sessionData.revision));
        }
        return handleInjectSession(
          message.url,
          message.sessionData,
          message.openAs,
          message.proxyData,
          message.enableIncognitoRestart,
          message.cardId,
          message.enableClearCacheBtn,
          Boolean(message.verificationCompatibility)
        );
      })
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ error: err.message }));
    return true; // Keep message channel open
  }
  if (messageType === "EXTRACT_SESSION") {
    handleExtractSession(message.url, message.extractFromIncognito).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (messageType === "CLEAR_AND_OPEN") {
    handleClearAndOpen(
      message.url,
      message.openAs,
      message.proxyData,
      message.enableIncognitoRestart,
      message.cardId,
      message.dontClearCookies,
      message.enableClearCacheBtn,
      Boolean(message.verificationCompatibility)
    )
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (messageType === "RELOAD_INCOGNITO") {
    if (sender.tab) {
      wipeStorage(sender.tab.id).then(() => {
        chrome.tabs.reload(sender.tab.id);
      });
    }
    return true;
  }
  if (messageType === "CLEAR_DOMAIN_CACHE_NO_COOKIES") {
    try {
      new URL(message.url);
      chrome.browsingData.removeCache({ since: 0 }, () => {
        const lastError = chrome.runtime.lastError;
        sendResponse(lastError ? { success: false, error: lastError.message } : { success: true });
      });
    } catch(e) {
      sendResponse({ success: false, error: e.message });
    }
    return true;
  }
  if (messageType === "CLEAR_DOMAIN_CACHE") {
    try {
      const urlObj = new URL(message.url);
      chrome.browsingData.remove({
        origins: [urlObj.origin]
      }, {
        "appcache": true,
        "cache": true,
        "cacheStorage": true,
        "fileSystems": true,
        "indexedDB": true,
        "localStorage": true,
        "serviceWorkers": true,
        "webSQL": true
      }, () => {
        sendResponse({ success: true });
      });
    } catch(e) {
      sendResponse({ success: false });
    }
    return true;
  }
  if (messageType === "AUTO_INJECT_NOW") {
    handleAutoInject(sender.tab ? sender.tab.id : null, message.cardId)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (messageType === "DOWNLOAD_GROK_ASSET") {
    (async () => {
      const assetUrl = new URL(message.url);
      if (assetUrl.protocol !== 'https:' || assetUrl.hostname !== 'assets.grok.com') {
        throw new Error('URL de descarga no permitida');
      }
      const filename = String(message.filename || 'archivo-grok')
        .replace(/[\\/:*?"<>|]/g, '_')
        .slice(0, 180);
      const downloadId = await chrome.downloads.download({
        url: assetUrl.href,
        filename,
        conflictAction: 'uniquify',
        saveAs: true
      });
      return { success: true, downloadId };
    })().then(sendResponse).catch(error => sendResponse({ error: error.message }));
    return true;
  }
  if (messageType === "OPEN_TOOL_WINDOW") {
    const isIncognito = sender.tab ? sender.tab.incognito : false;
    handleOpenToolWindow(message.url, isIncognito, message.cardId)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

async function handleOpenToolWindow(url, isIncognito = false, cardId = null) {
  // Preparar sobre una página real. Algunos servidores/proxies en macOS
  // cierran /robots.txt sin cuerpo (ERR_EMPTY_RESPONSE), impidiendo llegar a
  // la herramienta aunque su URL principal funcione correctamente.
  const safeUrl = url;
  
  // Abrir en una ventana NORMAL nueva (con o sin incógnito según el origen)
  let tab;
  let prepWindowId = null;
  if (isIncognito) {
    const win = await chrome.windows.create({
      url: safeUrl,
      type: "normal",
      focused: false,
      incognito: true,
      state: "minimized"
    });
    prepWindowId = win.id;
    const tabs = await chrome.tabs.query({ windowId: win.id });
    tab = tabs[0];
  } else {
    tab = await chrome.tabs.create({ url: safeUrl, active: false });
  }
  const tabId = tab.id;
  
  if (cardId) {
    activeTracking.set(tabId, cardId);
    await persistActiveTracking();
    scheduleTrackedSessionSync(tabId, 45000);
    void sendPresence(cardId);
  }
  
  await waitForTabLoad(tabId);
  await wipeStorage(tabId);
  
  // Si es NanoBanana, inicializar la página principal de labs.google primero para evitar el bucle de estado
  if (url.includes('labs.google')) {
    await chrome.tabs.update(tabId, { url: "https://labs.google/" });
    await waitForTabLoad(tabId);
    // Esperar un segundo extra para que los scripts de inicialización de Google hagan su trabajo
    await new Promise(r => setTimeout(r, 1000));
  }
  
  // Navegar a la URL real
  await chrome.tabs.update(tabId, { url: url });
  const finalLoad = waitForTabLoad(tabId);
  if (isIncognito && prepWindowId) {
    await chrome.windows.update(prepWindowId, { state: "normal", focused: true }).catch(() => {});
  } else {
    const finalWindow = await chrome.windows.create({ tabId, type: "normal", focused: true }).catch(() => null);
    if (!finalWindow) {
      await chrome.tabs.update(tabId, { active: true }).catch(() => {});
      if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    }
  }
  await finalLoad;
  
  return { success: true };
}

async function readAuthSecret(key) {
  const session = await chrome.storage.session.get(key);
  if (session[key]) return session[key];
  const local = await chrome.storage.local.get(key);
  if (local[key]) {
    await chrome.storage.session.set({ [key]: local[key] });
    // Los tokens pueden ser persistentes cuando se marca "Recordar sesión".
    // Copiarlos a storage.session no debe destruir la copia persistente.
    if (key !== "ownerToken" && key !== "refreshToken") {
      await chrome.storage.local.remove(key);
    }
    return local[key];
  }
  return "";
}

async function getSessionValues(keys) {
  const normalized = Array.isArray(keys) ? keys : [keys];
  const session = await chrome.storage.session.get(normalized);
  const missing = normalized.filter((key) => session[key] === undefined);
  if (!missing.length) return session;
  const local = await chrome.storage.local.get(missing);
  const toMigrate = {};
  for (const key of missing) {
    if (local[key] !== undefined) {
      session[key] = local[key];
      toMigrate[key] = local[key];
    }
  }
  if (Object.keys(toMigrate).length) {
    await chrome.storage.session.set(toMigrate);
    const transientKeys = Object.keys(toMigrate).filter(
      (key) => key !== "ownerToken" && key !== "refreshToken"
    );
    if (transientKeys.length) await chrome.storage.local.remove(transientKeys);
  }
  return session;
}

async function setSessionValues(values) {
  await chrome.storage.session.set(values);
  await chrome.storage.local.remove(Object.keys(values));
}

let authRefreshInFlight = null;

async function persistRefreshedAuthTokens(payload = {}) {
  const token = String(payload.token || payload.accessToken || "").trim();
  const refreshToken = String(payload.refreshToken || "").trim();
  if (!token) return "";

  // Mantener el alcance elegido en el login: si ya era persistente, rotar la
  // copia persistente; si no, conservar los tokens solo durante esta sesion.
  const persisted = await chrome.storage.local.get(["ownerToken", "refreshToken"]);
  const shouldPersist = Boolean(persisted.refreshToken || persisted.ownerToken);
  const values = { ownerToken: token };
  if (refreshToken) values.refreshToken = refreshToken;
  await chrome.storage.session.set(values);
  if (shouldPersist) await chrome.storage.local.set(values);
  else await chrome.storage.local.remove(Object.keys(values));
  return token;
}

async function refreshBackgroundAccessToken() {
  if (!authRefreshInFlight) {
    authRefreshInFlight = (async () => {
      const refreshToken = await readAuthSecret("refreshToken");
      if (!refreshToken) return "";
      let response;
      try {
        response = await fetch(`${DEFAULT_API_BASE}/api/public/refresh`, {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken })
        });
      } catch {
        return "";
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !(payload?.token || payload?.accessToken)) return "";
      return persistRefreshedAuthTokens(payload);
    })().finally(() => {
      authRefreshInFlight = null;
    });
  }
  return authRefreshInFlight;
}

async function fetchWithBackgroundAuth(path, options = {}, allowRefresh = true) {
  let token = await readAuthSecret("ownerToken");
  if (!token && allowRefresh) token = await refreshBackgroundAccessToken();
  if (!token) return { response: null, payload: {}, token: "", authRequired: true };

  let response;
  try {
    response = await fetch(`${DEFAULT_API_BASE}${path}`, {
      ...options,
      cache: "no-store",
      headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` }
    });
  } catch (networkError) {
    return { response: null, payload: {}, token, networkError };
  }

  const payload = await response.json().catch(() => ({}));
  const code = String(payload?.code || (response.status === 401 ? "AUTH_REQUIRED" : ""));
  const refreshable = response.status === 401 && [
    "AUTH_REQUIRED",
    "TOKEN_EXPIRED",
    "TOKEN_INVALID",
    "SESSION_EXPIRED"
  ].includes(code);
  if (allowRefresh && refreshable) {
    const refreshedToken = await refreshBackgroundAccessToken();
    if (refreshedToken) return fetchWithBackgroundAuth(path, options, false);
  }
  return { response, payload, token };
}

const ACCESS_STATE_KEYS = [
  "ownerToken",
  "refreshToken",
  "guestPassword",
  "botEmail",
  "botPassword",
  "pendingInjectCardId",
  "clientCanInject",
  "clientInjectMethod",
  "pendingClearCacheBtn",
  "verificationCompatibility",
  "iamax_admin_role",
  "iamax_must_setup_2fa"
];

async function revokeExtensionAccess(reason = "ACCESS_REVOKED") {
  for (const timer of sessionSyncTimers.values()) clearTimeout(timer);
  sessionSyncTimers.clear();
  activeTracking.clear();
  sessionRevisionByCard.clear();
  await Promise.all([
    chrome.storage.session.remove([...ACCESS_STATE_KEYS, "activeProfileTabs"]).catch(() => {}),
    chrome.storage.local.remove(ACCESS_STATE_KEYS).catch(() => {})
  ]);
  const tabs = await chrome.tabs.query({}).catch(() => []);
  await Promise.all(tabs.map((tab) => (
    Number.isInteger(tab.id)
      ? chrome.tabs.sendMessage(tab.id, { type: "IAMAX_ACCESS_REVOKED", reason }).catch(() => {})
      : Promise.resolve()
  )));
}

async function requireLiveAccess(cardId = null) {
  const result = await fetchWithBackgroundAuth("/api/public/dashboard");
  if (result.authRequired) {
    await revokeExtensionAccess("AUTH_REQUIRED");
    return { ok: false, error: "Debes iniciar sesion para continuar.", code: "AUTH_REQUIRED" };
  }
  if (result.networkError || !result.response) {
    return {
      ok: false,
      error: "No se pudo verificar el plan con el servidor. No se inyectaron datos.",
      code: "ACCESS_CHECK_FAILED"
    };
  }

  const { response, payload, token } = result;
  if (!response.ok || payload?.isLocked) {
    const code = payload?.code || (response.status === 401 ? "AUTH_REQUIRED" : "ACCESS_REVOKED");
    await revokeExtensionAccess(code);
    return { ok: false, error: payload?.error || "Acceso vencido o revocado.", code };
  }

  if (cardId !== null && cardId !== undefined && cardId !== "") {
    const allowed = Array.isArray(payload?.cards)
      && payload.cards.some((card) => String(card.id) === String(cardId));
    if (!allowed) {
      return { ok: false, error: "Esta tarjeta ya no esta asignada a tu cuenta.", code: "CARD_ACCESS_REVOKED" };
    }
  }

  return { ok: true, token };
}

async function handleAutoInject(senderTabId = null, specificCardId = null) {
  const sessionValues = await getSessionValues(["pendingInjectCardId"]);
  const targetCardId = specificCardId || sessionValues.pendingInjectCardId;
  if (!targetCardId) return { error: "No hay tarjeta seleccionada" };

  const access = await requireLiveAccess(targetCardId);
  if (!access.ok) return { success: false, error: access.error, code: access.code };

  const guestPassword = await readAuthSecret("guestPassword");
  const headers = {};
  if (guestPassword) headers["X-Guest-Password"] = guestPassword;
  
  try {
    const requestedCardId = encodeURIComponent(String(targetCardId));
    const secretsResult = await fetchWithBackgroundAuth(`/api/public/2fa?cardId=${requestedCardId}`, { headers });
    if (secretsResult.authRequired) {
      await revokeExtensionAccess("AUTH_REQUIRED");
      return { success: false, error: "Tu sesion de IAmax expiro. Inicia sesion nuevamente.", code: "AUTH_REQUIRED" };
    }
    if (secretsResult.networkError || !secretsResult.response) {
      return { success: false, error: "No se pudo conectar con el servidor de IAmax.", code: "ACCESS_CHECK_FAILED" };
    }
    const { response: res, payload: data } = secretsResult;
    if (!res.ok || !data.success || !data.codes) {
      const code = data?.code || (res.status === 401 ? "AUTH_REQUIRED" : "CREDENTIALS_UNAVAILABLE");
      // Un 403 puede indicar que esta tarjeta no permite inyección. No se debe
      // borrar por eso una sesión válida del dashboard.
      if (res.status === 401) await revokeExtensionAccess(code);
      return { success: false, error: data?.error || "No se pudieron obtener credenciales", code };
    }
    
    const card = data.codes.find(c => String(c.id) === String(targetCardId));
    if (!card) return { success: false, error: "Credenciales no encontradas para esta tarjeta" };
    
    const totpCode = card.code === "------" ? "" : card.code.replace(/\s+/g, '');
    
    if (!card.login_email || card.login_email.trim() === "") {
      return { success: false, error: "Correo vacío en el panel" };
    }

    // Ejecutar inyección
    const injectResult = await handleInjectCredentials(card.login_email, card.login_password, totpCode, senderTabId);
    if (!injectResult.success) {
      return { success: false, error: "Fallo inyección: " + injectResult.message };
    }
    
    return { success: true };
  } catch(e) {
    return { success: false, error: "Error de conexión con el backend: " + e.message };
  }
}

function isVerificationProviderCookie(cookie = {}) {
  const name = String(cookie.name || "").toLowerCase();
  return name === "cf_clearance" ||
    name === "__cf_bm" ||
    name === "__cfseq" ||
    name === "__cfruid" ||
    name === "_cfuvid" ||
    name === "cf_ob_info" ||
    name === "cf_use_ob" ||
    name.startsWith("cf_chl_") ||
    name.startsWith("__cf_chl_");
}

function isVerificationStorageKey(key = "") {
  return /(?:^|[_-])cf(?:[_-]|$)|cloudflare|turnstile|challenge/i.test(String(key || ""));
}

async function markVerificationCompatibility(enabled) {
  await setSessionValues({ verificationCompatibility: Boolean(enabled) }).catch(() => {});
}

async function applyVerificationPrep(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        try {
          localStorage.setItem("__iamax_skip_spoof__", "1");
        } catch (e) {}
      }
    });
  } catch (e) {}
}

async function wipeStorage(tabId, { verificationCompatible = false } = {}) {
  try {
    await Promise.race([
      chrome.scripting.executeScript({
        target: { tabId },
        func: async (skipHeavyPurge) => {
          localStorage.clear();
          sessionStorage.clear();
          if (skipHeavyPurge) return;
          try {
            if (window.indexedDB && window.indexedDB.databases) {
              const dbs = await window.indexedDB.databases();
              dbs.forEach(db => window.indexedDB.deleteDatabase(db.name));
            }
          } catch (e) {}
          try {
            if (navigator.serviceWorker) {
              const regs = await navigator.serviceWorker.getRegistrations();
              regs.forEach(reg => reg.unregister());
            }
          } catch (e) {}
        },
        args: [verificationCompatible]
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout wiping storage")), 3000))
    ]);
  } catch(e) {}
}

const waitForTabLoad = async (tabId) => {
  return new Promise(resolve => {
    let resolved = false;
    let timer = null;
    const finish = () => {
      if (!resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(listener);
        if (timer) clearTimeout(timer);
        resolve();
      }
    };
    function listener(tId, info) { if (tId === tabId && info.status === 'complete') finish(); }
    chrome.tabs.onUpdated.addListener(listener);
    timer = setTimeout(finish, 5000);
    chrome.tabs.get(tabId, (t) => { if (t && t.status === 'complete') finish(); });
  });
};

function getRootDomain(hostname) {
  const normalized = String(hostname || "").replace(/^www\./, "").toLowerCase();
  const parts = normalized.split(".").filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join(".") : normalized;
}

function getSessionDomains(hostname) {
  const normalized = String(hostname || "").replace(/^www\./, "").toLowerCase();
  const rootDomain = getRootDomain(normalized);
  const domains = new Set([rootDomain]);

  if (rootDomain === "chatgpt.com" || rootDomain === "openai.com" || normalized.includes("openai.com")) {
    domains.add("chatgpt.com");
    domains.add("openai.com");
    domains.add("auth.openai.com");
  }

  if (
    normalized.includes("labs.google") ||
    normalized.includes("youtube.com") ||
    normalized.includes("aistudio.google") ||
    normalized.includes("google.com") ||
    normalized.includes("musicgpt.com")
  ) {
    domains.add("google.com");
    domains.add("accounts.google.com");
    domains.add("youtube.com");
  }

  // Scribd comparte la misma cuenta con Everand y SlideShare.
  if (
    rootDomain === "scribd.com" ||
    rootDomain === "everand.com" ||
    rootDomain === "slideshare.net"
  ) {
    domains.add("scribd.com");
    domains.add("everand.com");
    domains.add("slideshare.net");
  }

  if (rootDomain === "grok.com" || rootDomain === "x.ai") {
    domains.add("grok.com");
    domains.add("x.ai");
    domains.add("accounts.x.ai");
  }

  return [...domains].filter(Boolean);
}

const GOOGLE_COOKIE_ROOTS = Object.freeze([
  "google.com",
  "googleusercontent.com",
  "gstatic.com",
  "googleapis.com",
  "ggpht.com",
  "youtube.com",
  "ytimg.com"
]);

function domainMatchesRoot(domain, root) {
  const normalizedDomain = String(domain || "").replace(/^\./, "").toLowerCase();
  const normalizedRoot = String(root || "").replace(/^\./, "").toLowerCase();
  return Boolean(normalizedDomain && normalizedRoot)
    && (normalizedDomain === normalizedRoot || normalizedDomain.endsWith(`.${normalizedRoot}`));
}

function isGoogleSessionHost(hostname) {
  const normalized = String(hostname || "").replace(/^www\./, "").toLowerCase();
  return GOOGLE_COOKIE_ROOTS.some((root) => domainMatchesRoot(normalized, root))
    || normalized.includes("labs.google")
    || normalized.includes("aistudio.google")
    || normalized.includes("musicgpt.com");
}

function getCleanupDomains(hostname) {
  const domains = new Set(getSessionDomains(hostname));
  if (isGoogleSessionHost(hostname)) {
    GOOGLE_COOKIE_ROOTS.forEach((root) => domains.add(root));
    domains.add("accounts.google.com");
    domains.add("gemini.google.com");
  }
  return [...domains].filter(Boolean);
}

async function getCookiesForDomains(domains, storeId) {
  const cookieMap = new Map();

  // En incognito todas las ventanas del mismo perfil comparten un solo
  // cookie store. Leer el store completo y filtrar localmente evita dejar
  // cookies de identidad en hosts auxiliares (gstatic, googleusercontent,
  // googleapis, ggpht, etc.). Nunca se consulta el store normal en esta rama.
  if (storeId) {
    const allStoreCookies = await chrome.cookies.getAll({ storeId }).catch(() => []);
    for (const cookie of allStoreCookies) {
      if (!domains.some((domain) => domainMatchesRoot(cookie.domain, domain))) continue;
      cookieMap.set(`${cookie.storeId || storeId}|${cookie.partitionKey?.topLevelSite || ""}|${cookie.partitionKey?.hasCrossSiteAncestor ? "1" : "0"}|${cookie.domain}|${cookie.path}|${cookie.name}`, cookie);
    }
    return [...cookieMap.values()];
  }

  for (const domain of domains) {
    const args = { domain };
    if (storeId) args.storeId = storeId;
    const domainCookies = await chrome.cookies.getAll(args).catch(() => []);
    for (const cookie of domainCookies) {
      cookieMap.set(`${cookie.storeId || storeId || "0"}|${cookie.partitionKey?.topLevelSite || ""}|${cookie.partitionKey?.hasCrossSiteAncestor ? "1" : "0"}|${cookie.domain}|${cookie.path}|${cookie.name}`, cookie);
    }
  }
  return [...cookieMap.values()];
}

async function removeCookiesForDomains(domains, storeId = null) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const cookies = await getCookiesForDomains(domains, storeId);
    if (!cookies.length) return;
    for (const cookie of cookies) {
      const cookieHost = String(cookie.domain || "").replace(/^\./, "");
      if (!cookieHost || !cookie.name) continue;
      const removeDetails = {
        url: `${cookie.secure ? "https" : "http"}://${cookieHost}${cookie.path || "/"}`,
        name: cookie.name
      };
      if (cookie.storeId) removeDetails.storeId = cookie.storeId;
      if (cookie.partitionKey) removeDetails.partitionKey = cookie.partitionKey;
      await chrome.cookies.remove(removeDetails).catch(() => {});
    }
  }

  const remaining = await getCookiesForDomains(domains, storeId);
  if (remaining.length) {
    console.warn(`[IAMAX] Quedaron ${remaining.length} cookies en el almacen aislado despues de limpiar.`);
  }
}

async function purgeWebStorageForDomains(domains) {
  const relatedRoots = new Set(domains.map(getRootDomain));
  const openTabs = await chrome.tabs.query({}).catch(() => []);
  const staleTabIds = openTabs
    .filter(tab => {
      try { return relatedRoots.has(getRootDomain(new URL(tab.url).hostname)); } catch (error) { return false; }
    })
    .map(tab => tab.id)
    .filter(Number.isInteger);
  if (staleTabIds.length) await chrome.tabs.remove(staleTabIds).catch(() => {});

  const origins = [...new Set(domains.flatMap(domain => [domain, `www.${domain}`]))];
  await Promise.all(origins.map(async domain => {
    let tab = null;
    try {
      tab = await chrome.tabs.create({ url: `https://${domain}/robots.txt`, active: false });
      await waitForTabLoad(tab.id);
      await wipeStorage(tab.id);
    } catch (error) {
      // Las cookies igualmente ya fueron borradas aunque el origen no responda.
    } finally {
      if (tab?.id) await chrome.tabs.remove(tab.id).catch(() => {});
    }
  }));
}

let inMemoryProxyMappings = {};
let inMemoryProxyMappingsInc = {};

// Cargar en memoria al iniciar
chrome.storage.local.get(["proxyMappings", "proxyMappings_incognito"], (local) => {
  if (local.proxyMappings) inMemoryProxyMappings = local.proxyMappings;
  if (local.proxyMappings_incognito) inMemoryProxyMappingsInc = local.proxyMappings_incognito;
});

async function applyProxyConfig(url, proxyData, scopeParam = "regular") {
  try {
    const urlObj = new URL(url);
    let rootDomain = urlObj.hostname;
    const parts = rootDomain.split('.');
    if (parts.length > 2) {
      rootDomain = parts.slice(-2).join('.');
    }

    const mappingKey = scopeParam === "incognito_persistent" ? "proxyMappings_incognito" : "proxyMappings";
    const local = await chrome.storage.local.get(mappingKey);
    const mappings = local[mappingKey] || {};

    // La configuración del servidor es la fuente de verdad. Si esta tarjeta ya
    // no tiene proxy, elimina solo su PAC antiguo; de otro modo Chrome (sobre
    // todo en macOS) sigue intentando un proxy muerto y muestra
    // ERR_EMPTY_RESPONSE aunque el backend ya lo haya desactivado.
    if (!proxyData || !String(proxyData.host || '').trim() || !String(proxyData.port || '').trim()) {
      if (!Object.prototype.hasOwnProperty.call(mappings, rootDomain)) return;
      delete mappings[rootDomain];
      await chrome.storage.local.set({ [mappingKey]: mappings });
      if (scopeParam === "incognito_persistent") inMemoryProxyMappingsInc = mappings;
      else inMemoryProxyMappings = mappings;
      await installProxyMappings(mappings, scopeParam);
      return;
    }

    // Clean proxy data to avoid spaces
    proxyData = { ...proxyData };
    proxyData.host = String(proxyData.host).trim();
    proxyData.port = String(proxyData.port).trim();
    if (proxyData.username) proxyData.username = String(proxyData.username).trim();
    if (proxyData.password) proxyData.password = String(proxyData.password).trim();

    let rawHost = proxyData.host;
    let pacProtocol = "PROXY";
    if (rawHost.startsWith('socks5://')) { pacProtocol = "SOCKS5"; rawHost = rawHost.replace('socks5://', ''); }
    else if (rawHost.startsWith('socks4://')) { pacProtocol = "SOCKS4"; rawHost = rawHost.replace('socks4://', ''); }
    else if (rawHost.startsWith('http://')) { pacProtocol = "PROXY"; rawHost = rawHost.replace('http://', ''); }
    else if (rawHost.startsWith('https://')) { pacProtocol = "HTTPS"; rawHost = rawHost.replace('https://', ''); }
    else {
      const configuredProtocol = String(proxyData.protocol || proxyData.type || '').toLowerCase();
      if (configuredProtocol.includes('socks5')) pacProtocol = "SOCKS5";
      else if (configuredProtocol.includes('socks4')) pacProtocol = "SOCKS4";
      else if (configuredProtocol === 'https') pacProtocol = "HTTPS";
    }
    rawHost = rawHost
      .split('/')[0]
      .split('@')
      .pop()
      .replace(/\/+$/, '')
      .trim();
    const hostWithPort = rawHost.match(/^([^:\[\]]+):(\d+)$/);
    if (hostWithPort) {
      rawHost = hostWithPort[1];
      if (!proxyData.port) proxyData.port = hostWithPort[2];
    }
    
    proxyData.host = rawHost;
    proxyData.pacProtocol = pacProtocol;

    proxyData.port = String(proxyData.port).trim();
    if (proxyData.username) proxyData.username = proxyData.username.trim();
    if (proxyData.password) proxyData.password = proxyData.password.trim();

    // Chrome/Chromium no implementa autenticacion username/password para
    // proxies SOCKS configurados mediante chrome.proxy. onAuthRequired solo
    // puede responder challenges HTTP(S); con SOCKS autenticado Chrome falla
    // directamente con ERR_SOCKS_CONNECTION_FAILED. La app de escritorio
    // resuelve esto con un puente local, pero una extension MV3 instalada en
    // Chrome no puede levantar ese servidor. Evita dejar un PAC roto activo
    // para el dominio y abre esta tarjeta por conexion directa.
    const authenticatedSocks = (pacProtocol === "SOCKS5" || pacProtocol === "SOCKS4")
      && Boolean(proxyData.username || proxyData.password);
    if (authenticatedSocks) {
      delete mappings[rootDomain];
      await chrome.storage.local.set({ [mappingKey]: mappings });
      if (scopeParam === "incognito_persistent") inMemoryProxyMappingsInc = mappings;
      else inMemoryProxyMappings = mappings;
      await installProxyMappings(mappings, scopeParam);
      console.warn(
        `[Proxy] ${rootDomain}: SOCKS autenticado no es compatible con extensiones Chrome; ` +
        "se retiro el PAC incompatible para evitar ERR_SOCKS_CONNECTION_FAILED."
      );
      return { applied: false, bypassed: true, reason: "authenticated-socks-unsupported" };
    }

    // Add or update the mapping for this domain
    mappings[rootDomain] = proxyData;
    await chrome.storage.local.set({ [mappingKey]: mappings });

    // Actualizar cache en memoria
    if (scopeParam === "incognito_persistent") {
      inMemoryProxyMappingsInc = mappings;
    } else {
      inMemoryProxyMappings = mappings;
    }

    await installProxyMappings(mappings, scopeParam);
    return { applied: true, bypassed: false };
  } catch (err) {
    console.error("Error applying proxy config", err);
    return { applied: false, bypassed: false, error: err?.message || String(err) };
  }
}

async function purgeWebStorageInIncognitoWindow(domains, windowId, tabId) {
  if (!Number.isInteger(windowId) || !Number.isInteger(tabId)) return;
  const identityDomains = [...new Set(domains)]
    .filter((domain) => domain === "accounts.google.com" || domain === "google.com" || domain === "gemini.google.com" || domain === "youtube.com");

  for (const domain of identityDomains) {
    try {
      await chrome.tabs.update(tabId, { url: `https://${domain}/`, active: false });
      await waitForTabLoad(tabId);
      await wipeStorage(tabId);
    } catch (error) {
      console.warn(`[IAMAX] No se pudo limpiar storage incognito de ${domain}:`, error?.message || error);
    }
  }

  await chrome.tabs.update(tabId, { url: "about:blank", active: false }).catch(() => {});
}

async function installProxyMappings(mappings, scopeParam = "regular") {
  let pacScript = "function FindProxyForURL(url, host) {\n";
  if (mappings["chatgpt.com"] && mappings["chatgpt.com"].host !== "RAILWAY_TUNNEL" && !mappings["chatgpt.com"].host.toLowerCase().includes("railway")) {
    const p = mappings["chatgpt.com"];
    const pacProto = p.pacProtocol || "PROXY";
    pacScript += `  if (dnsDomainIs(host, "api.ipify.org") || dnsDomainIs(host, "ipify.org")) return "${pacProto} ${p.host}:${p.port}";\n`;
  }
  for (const [domain, proxy] of Object.entries(mappings)) {
    if (proxy.host === "RAILWAY_TUNNEL" || proxy.host.toLowerCase().includes("railway")) continue;
    const pacProto = proxy.pacProtocol || "PROXY";
    pacScript += `  if (dnsDomainIs(host, "${domain}") || dnsDomainIs(host, ".${domain}")) return "${pacProto} ${proxy.host}:${proxy.port}";\n`;
  }
  pacScript += "  return 'DIRECT';\n}\n";
  const value = { mode: "pac_script", pacScript: { data: pacScript } };
  if (scopeParam === "incognito_persistent") {
    await chrome.proxy.settings.set({ value, scope: "incognito_persistent" });
  } else {
    await chrome.proxy.settings.set({ value, scope: "regular" });
  }
}

// Chrome proxy auth handler (SYNCHRONOUS FOR MAXIMUM COMPATIBILITY WITH ANTIDETECT BROWSERS)
chrome.webRequest.onAuthRequired.addListener(
  (details) => {
    if (!details.isProxy) return {};
    
    const proxyHost = details.challenger.host;
    const proxyPort = details.challenger.port.toString();

    // 1. Try exact match in regular
    for (const key in inMemoryProxyMappings) {
      const p = inMemoryProxyMappings[key];
      if (p.host === proxyHost && String(p.port) === proxyPort && p.username && p.password) {
        return { authCredentials: { username: p.username, password: p.password } };
      }
    }
    
    // 2. Try exact match in incognito
    for (const key in inMemoryProxyMappingsInc) {
      const p = inMemoryProxyMappingsInc[key];
      if (p.host === proxyHost && String(p.port) === proxyPort && p.username && p.password) {
        return { authCredentials: { username: p.username, password: p.password } };
      }
    }
    
    // 3. FALLBACK: Any valid credentials in regular
    for (const key in inMemoryProxyMappings) {
      const p = inMemoryProxyMappings[key];
      if (p.username && p.password) {
        return { authCredentials: { username: p.username, password: p.password } };
      }
    }
    
    // 4. FALLBACK: Any valid credentials in incognito
    for (const key in inMemoryProxyMappingsInc) {
      const p = inMemoryProxyMappingsInc[key];
      if (p.username && p.password) {
        return { authCredentials: { username: p.username, password: p.password } };
      }
    }
    
    return {};
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);

async function handleClearAndOpen(url, openAs = "popup", proxyData = null, enableIncognitoRestart = false, cardId = null, dontClearCookies = false, enableClearCacheBtn = false, verificationCompatibility = false) {
  const parsedUrl = new URL(url);
  const hostname = parsedUrl.hostname.replace(/^www\./, '');
  const domainsToClear = getCleanupDomains(hostname);
  await chrome.storage.local.set({ pendingClearCacheBtn: Boolean(enableClearCacheBtn) }).catch(() => {});
  await markVerificationCompatibility(verificationCompatibility);

  const isIncognito = openAs.startsWith("incognito");
  const isPopup = openAs.includes("popup");

  await applyProxyConfig(url, proxyData, isIncognito ? "incognito_persistent" : "regular");

  const safeUrl = url;
  let firstUrl = isIncognito ? "about:blank" : url;
  
  let tab;
  let prepWindowId = null;
  let storeId = null;
  if (isIncognito) {
      const win = await chrome.windows.create({
        url: firstUrl,
        type: isPopup ? "popup" : "normal",
        incognito: true,
        focused: false,
        state: "minimized"
      });
      prepWindowId = win.id;
      const tabs = await chrome.tabs.query({ windowId: win.id });
      tab = tabs[0];
      const stores = await chrome.cookies.getAllCookieStores();
      const store = stores.find((candidate) => candidate.tabIds.includes(tab.id))
        || stores.find((candidate) => candidate.id !== "0");
      if (!store?.id || store.id === "0") {
        throw new Error("No se pudo resolver el almacen incognito aislado.");
      }
      storeId = store.id;
  } else {
      tab = await chrome.tabs.create({ url: firstUrl, active: false });
  }

  if (!dontClearCookies) {
    // En incognito hay que indicar el storeId. Sin el, Chrome usa el perfil
    // normal y deja vivas las cuentas del almacen incognito compartido.
    await removeCookiesForDomains(domainsToClear, storeId);
    if (isIncognito) {
      await purgeWebStorageInIncognitoWindow(domainsToClear, prepWindowId, tab.id);
    } else if (!verificationCompatibility) {
      await purgeWebStorageForDomains(domainsToClear);
    }
  }

  if (cardId) {
    activeTracking.set(tab.id, cardId);
    await persistActiveTracking();
    scheduleTrackedSessionSync(tab.id, 45000);
    void sendPresence(cardId);
  }

  const revealTab = async () => {
    if (isIncognito && prepWindowId) {
      await chrome.windows.update(prepWindowId, { state: "normal", focused: true }).catch(() => {});
    } else if (isPopup) {
      await chrome.windows.create({ tabId: tab.id, type: "popup", focused: true }).catch(async () => {
        await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
        if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      });
    } else {
      await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
      if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    }
  };

  let finalLoad = Promise.resolve();
  if (!dontClearCookies) {
    if (firstUrl !== "about:blank") {
      await waitForTabLoad(tab.id);
      await wipeStorage(tab.id, { verificationCompatible: verificationCompatibility });
      if (verificationCompatibility) await applyVerificationPrep(tab.id);
    }

    if (firstUrl !== safeUrl) {
      await chrome.tabs.update(tab.id, { url: safeUrl });
      await waitForTabLoad(tab.id);
      await wipeStorage(tab.id, { verificationCompatible: verificationCompatibility });
      if (verificationCompatibility) await applyVerificationPrep(tab.id);
    }

    await chrome.tabs.update(tab.id, { url, active: false });
    finalLoad = waitForTabLoad(tab.id);
  } else {
    if (verificationCompatibility) {
      await waitForTabLoad(tab.id);
      await applyVerificationPrep(tab.id);
    }
    // Si abrimos la URL real directamente, igual debemos esperar a que cargue
    finalLoad = waitForTabLoad(tab.id);
  }

  await revealTab();
  await finalLoad;

  if (enableIncognitoRestart) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["incognito_btn.js"]
      });
    } catch(e) {}
  }
  
  return { success: true };
}

async function handleInjectCredentials(email, password, totpCode = "", senderTabId = null) {
  let targetTab = null;
  
  if (senderTabId) {
    try {
      targetTab = await chrome.tabs.get(senderTabId);
    } catch (e) {
      targetTab = null;
    }
  }

  if (targetTab && targetTab.url && (targetTab.url.includes("chrome-extension://") || targetTab.url.includes("iamaxbackenv2"))) {
    targetTab = null;
  }

  if (!targetTab) {
    // 1. Intentar encontrar una pestaña de Google Login ACTIVA
    const activeGoogleTabs = await chrome.tabs.query({ active: true, url: "*://accounts.google.com/*" });
    if (activeGoogleTabs.length > 0) {
      targetTab = activeGoogleTabs[0];
    } else {
      // 2. Fallback a cualquier pestaña de Google
      const googleTabs = await chrome.tabs.query({ url: "*://accounts.google.com/*" });
      if (googleTabs.length > 0) {
        targetTab = googleTabs[0];
      } else {
        // 3. Si no hay Google, buscar cualquier pestaña activa que no sea el dashboard
        const activeTabs = await chrome.tabs.query({ active: true });
        targetTab = activeTabs.find(t => t.url && !t.url.includes("chrome-extension://") && !t.url.includes("iamaxbackenv2"));
      }
    }
  }

  // 4. Fallback final: la última pestaña que no sea extensión
  if (!targetTab) {
    const allTabs = await chrome.tabs.query({});
    for (let i = allTabs.length - 1; i >= 0; i--) {
      if (allTabs[i].url && !allTabs[i].url.includes("chrome-extension://") && !allTabs[i].url.includes("iamaxbackenv2")) {
        targetTab = allTabs[i];
        break;
      }
    }
  }

  if (!targetTab) return { success: false, message: "No hay ventana abierta" };

  const injectionResult = await chrome.scripting.executeScript({
    target: { tabId: targetTab.id },
    func: (email, password, totpCode) => {
      console.log("[IAMAX-INJECT] Script inyectado en:", window.location.href);
      
      // Usar WeakSet evita modificar el DOM (dataset) lo cual es detectado por BotGuard
      const injectedElements = new WeakSet();

      // Función mágica que salta las protecciones de React/Google y fuerza el valor nativamente
      const setNativeValue = (element, value) => {
        try {
          const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
          const prototype = Object.getPrototypeOf(element);
          const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
          
          element.focus();
          
          if (valueSetter && prototypeValueSetter && valueSetter !== prototypeValueSetter) {
              prototypeValueSetter.call(element, value);
          } else if (valueSetter) {
              valueSetter.call(element, value);
          } else {
              element.value = value;
          }
          
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
          element.blur();
        } catch(e) {
          console.error("[IAMAX-INJECT] Error en setNativeValue:", e);
          element.value = value;
          element.dispatchEvent(new Event('input', { bubbles: true }));
        }
      };

      const injectPasswords = () => {
          let injected = 0;
          const passInputs = document.querySelectorAll('input[type="password"], input[name*="pass"]:not([type="hidden"]), input[id*="pass"]:not([type="hidden"]), input[autocomplete="current-password"]');
          passInputs.forEach(i => {
              if (i.type !== 'hidden' && !String(i.value || '') && !injectedElements.has(i)) {
                  injectedElements.add(i);
                  injected++;
                  setTimeout(() => setNativeValue(i, password), 600);
              }
          });
          return injected;
      };

      const injectTOTP = () => {
          if (!totpCode) return 0;
          let injected = 0;
          const totpInputs = document.querySelectorAll('input[type="tel"], input[name*="totp" i]:not([type="hidden"]), input[id*="totp" i]:not([type="hidden"]), input[name*="pin" i]:not([type="hidden"]), input[id*="pin" i]:not([type="hidden"]), input[autocomplete="one-time-code"]');
          totpInputs.forEach(i => {
              if (i.type !== 'hidden' && !String(i.value || '') && !injectedElements.has(i)) {
                  injectedElements.add(i);
                  injected++;
                  setTimeout(() => setNativeValue(i, totpCode), 700);
              }
          });
          return injected;
      };

      const injectEmail = () => {
          let injected = 0;
          // Buscar todos los inputs del documento
          const allInputs = document.querySelectorAll('input');
          console.log("[IAMAX-INJECT] Total inputs en el DOM:", allInputs.length);
          allInputs.forEach((inp, idx) => {
              console.log(`[IAMAX-INJECT] Input[${idx}]: type=${inp.type}, id=${inp.id}, name=${inp.name}, autocomplete=${inp.autocomplete}, offsetParent=${inp.offsetParent !== null}, visible=${inp.getBoundingClientRect().width > 0}`);
          });
          
          const emailInputs = document.querySelectorAll('input[type="email"], input[name*="user"]:not([type="hidden"]), input[name*="email"]:not([type="hidden"]), input[id*="user"]:not([type="hidden"]), input[id*="email"]:not([type="hidden"]), input[name="identifier"], input[id="identifierId"], input[autocomplete="username"], input[autocomplete="email"]');
          console.log("[IAMAX-INJECT] Email inputs encontrados por selector:", emailInputs.length);
          
          emailInputs.forEach(i => {
              console.log("[IAMAX-INJECT] Evaluando input:", i.id, i.name, i.type, "offsetParent:", i.offsetParent !== null, "rect:", JSON.stringify(i.getBoundingClientRect()));
              // NO usar offsetParent - Google lo pone null con display:contents
              if (i.type !== 'hidden' && !String(i.value || '') && !injectedElements.has(i)) {
                  injectedElements.add(i);
                  injected++;
                  console.log("[IAMAX-INJECT] >>> INYECTANDO EMAIL:", email, "en input:", i.id || i.name);
                  setTimeout(() => setNativeValue(i, email), 400);
              }
          });
          
          // Si no se encontró nada con selectores, buscar CUALQUIER input de texto visible
          if (injected === 0) {
              console.log("[IAMAX-INJECT] No se encontró con selectores, buscando input de texto genérico...");
              const textInputs = document.querySelectorAll('input[type="text"], input:not([type])');
              textInputs.forEach(i => {
                  const rect = i.getBoundingClientRect();
                  if (rect.width > 0 && rect.height > 0 && !String(i.value || '').trim() && !injectedElements.has(i)) {
                      injectedElements.add(i);
                      injected++;
                      console.log("[IAMAX-INJECT] >>> INYECTANDO EMAIL (fallback) en input genérico:", i.id || i.name);
                      setTimeout(() => setNativeValue(i, email), 400);
                  }
              });
          }
          
          return injected;
      };

      let injectedEmail = injectEmail();
      let injectedPass = injectPasswords();
      let injectedTotp = injectTOTP();
      
      console.log("[IAMAX-INJECT] Resultados iniciales - Email:", injectedEmail, "Pass:", injectedPass, "TOTP:", injectedTotp);
      
      // Observer para inyectar a medida que la página (SPA de React) carga nuevos campos dinámicamente
      let observer = null;
      if (injectedEmail === 0 || injectedPass === 0 || (totpCode && injectedTotp === 0)) {
          console.log("[IAMAX-INJECT] Activando MutationObserver para vigilar nuevos campos...");
          observer = new MutationObserver(() => {
              const e = injectEmail();
              const p = injectPasswords();
              const t = injectTOTP();
              if (p > 0 || t > 0 || e > 0) {
                  console.log("[IAMAX-INJECT] Observer detectó nuevos campos! Email:", e, "Pass:", p, "TOTP:", t);
                  setTimeout(() => {
                      if (observer) {
                          observer.disconnect();
                          observer = null;
                      }
                  }, 1000);
              }
          });
          observer.observe(document.body, { childList: true, subtree: true });
          
          // Timeout de seguridad: apagar observer a los 30 seg
          setTimeout(() => {
              if (observer) {
                  console.log("[IAMAX-INJECT] Observer timeout - desconectando tras 30s");
                  observer.disconnect();
                  observer = null;
              }
          }, 30000);
      }
      
      return `Email:${injectedEmail} Pass:${injectedPass} TOTP:${injectedTotp}`;
    },
    args: [email, password, totpCode]
  }).then(async res => {
    try {
      await chrome.windows.update(targetTab.windowId, { focused: true });
      await chrome.windows.update(targetTab.windowId, { drawAttention: true });
    } catch(e) {}
    return { success: true, message: `Inyectado en: ${targetTab.url} (${res[0]?.result})` };
  }).catch(e => {
    console.error("[IAMAX] Error al inyectar credenciales");
    return { success: false, message: e.message };
  });

  return injectionResult;
}

async function handleInjectSession(url, sessionData, openAs = "popup", proxyData = null, enableIncognitoRestart = false, cardId = null, enableClearCacheBtn = false, verificationCompatibility = false) {
  const parsedUrl = new URL(url);
  const hostname = parsedUrl.hostname.replace(/^www\./, '');
  // Cargar el destino real en segundo plano para obtener su origen. No usar
  // /robots.txt: varios servicios lo cierran sin respuesta en Chrome/macOS.
  const safeUrl = url;
  let storeId = null;
  let incognitoTabId = null;
  let incognitoWindowId = null;
  await chrome.storage.local.set({ pendingClearCacheBtn: Boolean(enableClearCacheBtn) }).catch(() => {});
  await markVerificationCompatibility(verificationCompatibility);

  const isIncognito = openAs.startsWith("incognito");
  const isPopup = openAs.includes("popup");

  if (isIncognito) {
    const win = await chrome.windows.create({
      url: "about:blank",
      type: isPopup ? "popup" : "normal",
      incognito: true,
      focused: false,
      state: "minimized"
    });
    incognitoWindowId = win.id;
    const tabs = await chrome.tabs.query({ windowId: win.id });
    incognitoTabId = tabs[0].id;
    const stores = await chrome.cookies.getAllCookieStores();
    
    const store = stores.find(s => s.tabIds.includes(incognitoTabId)) || stores.find(s => s.id !== "0");
    if (!store?.id || store.id === "0") {
      await chrome.windows.remove(incognitoWindowId).catch(() => {});
      throw new Error("No se pudo resolver el almacen incognito aislado.");
    }
    storeId = store.id;
  }

  const rootDomain = getRootDomain(hostname);

  try {
    const domainsToClear = getCleanupDomains(hostname);
    if (isIncognito && (!storeId || storeId === "0")) {
      throw new Error("No se pudo resolver el almacen incognito aislado.");
    }
    await removeCookiesForDomains(domainsToClear, storeId);

    // Las ventanas incognito de Chrome comparten su almacenamiento mientras
    // exista al menos una abierta. Limpiar solo cookies no elimina el selector
    // de cuentas recordado por accounts.google.com. Recorremos esos origenes
    // dentro de ESTA particion incognito, sin tocar el perfil normal de Chrome.
    if (isIncognito && incognitoWindowId && incognitoTabId) {
      await purgeWebStorageInIncognitoWindow(domainsToClear, incognitoWindowId, incognitoTabId);
    }
  } catch (e) {
    console.warn("Error clearing cookies", e);
  }

  await applyProxyConfig(url, proxyData, isIncognito ? "incognito_persistent" : "regular");

  if (sessionData.cookies_json) {
    try {
      const cookies = JSON.parse(sessionData.cookies_json)
        .filter(cookie => !verificationCompatibility || !isVerificationProviderCookie(cookie));
      for (const cookie of cookies) {
        let cookieUrl = (cookie.secure ? "https://" : "http://") + 
                        (cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain) + 
                        cookie.path;
        
        let mappedSameSite = "unspecified";
        if (cookie.sameSite) {
          const lower = cookie.sameSite.toLowerCase();
          if (lower === "none") mappedSameSite = "no_restriction";
          else if (lower === "lax") mappedSameSite = "lax";
          else if (lower === "strict") mappedSameSite = "strict";
        }

        const cookieDetails = {
          url: cookieUrl,
          name: cookie.name,
          value: cookie.value,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: mappedSameSite
        };
        
        if (storeId) cookieDetails.storeId = storeId;
        if (cookie.partitionKey?.topLevelSite) {
          cookieDetails.partitionKey = {
            topLevelSite: cookie.partitionKey.topLevelSite,
            hasCrossSiteAncestor: Boolean(cookie.partitionKey.hasCrossSiteAncestor)
          };
        }
        if (!cookie.hostOnly) cookieDetails.domain = cookie.domain;
        if (cookie.expirationDate) cookieDetails.expirationDate = cookie.expirationDate;

        await chrome.cookies.set(cookieDetails).catch((e) => {
          console.warn(`Failed to set cookie ${cookie.name} for ${cookieUrl}:`, e);
        });
      }
    } catch (e) {
      console.error("Error setting cookies JSON parse", e);
    }
  }

  let injectUrl = safeUrl;
  if (sessionData.local_storage_json) {
    try {
      const ls = JSON.parse(sessionData.local_storage_json);
      if (ls['_iamax_final_url']) {
        const urlObj = new URL(ls['_iamax_final_url']);
        injectUrl = urlObj.href;
      }
    } catch(e){}
  }

  let tab;
  let useHiddenTab = false;
  if (isIncognito) {
    tab = await chrome.tabs.update(incognitoTabId, { url: injectUrl });
  } else {
    // Both 'tab' and 'popup' can use a hidden tab to avoid showing robots.txt
    let firstUrl = injectUrl;
    tab = await chrome.tabs.create({ url: firstUrl, active: false });
    useHiddenTab = true;
    
    if (firstUrl !== injectUrl) {
      await waitForTabLoad(tab.id);
      await wipeStorage(tab.id, { verificationCompatible: verificationCompatibility });
      if (verificationCompatibility) await applyVerificationPrep(tab.id);
      await chrome.tabs.update(tab.id, { url: injectUrl });
    }
  }
  
  if (sessionData.local_storage_json || sessionData.session_storage_json) {
    await new Promise(resolve => {
      let resolved = false;
      const finish = () => {
        if (!resolved) {
          resolved = true;
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      
      function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') {
          finish();
        }
      }
      
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(finish, 2000);
      chrome.tabs.get(tab.id, (t) => {
        if (t && t.status === 'complete') finish();
      });
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (lsJson, ssJson, idbJson, verificationCompatible) => {
        const isVerificationKey = (key) => /(?:^|[_-])cf(?:[_-]|$)|cloudflare|turnstile|challenge/i.test(String(key || ""));
        try {
          localStorage.clear();
          sessionStorage.clear();
          const ls = JSON.parse(lsJson || "{}");
          for (const key in ls) {
            if (key !== "_iamax_final_url" && (!verificationCompatible || !isVerificationKey(key))) {
              localStorage.setItem(key, ls[key]);
            }
          }
          const ss = JSON.parse(ssJson || "{}");
          for (const key in ss) {
            if (!verificationCompatible || !isVerificationKey(key)) {
              sessionStorage.setItem(key, ss[key]);
            }
          }

          if (verificationCompatible) return;

          const idb = JSON.parse(idbJson || "{}");
          for (const dbName in idb) {
            const request = window.indexedDB.open(dbName);
            request.onsuccess = (e) => {
              const db = e.target.result;
              const stores = idb[dbName];
              for (const storeName in stores) {
                try {
                  const tx = db.transaction(storeName, "readwrite");
                  const store = tx.objectStore(storeName);
                  store.clear();
                  const data = stores[storeName];
                  for (let i = 0; i < data.keys.length; i++) {
                    store.put(data.values[i], data.keys[i]);
                  }
                } catch (err) {}
              }
            };
          }
        } catch (e) {
          console.error("Error setting storage", e);
        }
      },
      args: [
        sessionData.local_storage_json,
        sessionData.session_storage_json,
        sessionData.indexed_db_json,
        verificationCompatibility
      ]
    }).catch((error) => {
      // Una página protegida puede negar scripting. Eso no debe impedir que
      // el usuario llegue al destino; cookies del servidor ya fueron aplicadas.
      console.warn("Storage injection skipped; continuing to destination:", error?.message || error);
    });
    if (verificationCompatibility) await applyVerificationPrep(tab.id);
  }

  if (useHiddenTab) {
    await chrome.tabs.update(tab.id, { url, active: false });
    const finalLoad = waitForTabLoad(tab.id);
    if (isPopup) {
      try {
        await chrome.windows.create({ tabId: tab.id, type: "popup", focused: true });
      } catch(e) {}
    } else {
      await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
      if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    }
    await finalLoad;
  } else {
    // Incognito
    await chrome.tabs.update(tab.id, { url, active: false });
    const finalLoad = waitForTabLoad(tab.id);
    if (incognitoWindowId) {
      await chrome.windows.update(incognitoWindowId, { state: "normal", focused: true }).catch(() => {});
    }
    await finalLoad;
  }

  if (cardId && tab?.id) {
    activeTracking.set(tab.id, cardId);
    await persistActiveTracking();
    scheduleTrackedSessionSync(tab.id, 45000);
    void sendPresence(cardId);
  }

  if (enableIncognitoRestart) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["incognito_btn.js"]
      });
    } catch(e) {}
  }
  
  return { success: true };
}

async function handleExtractSession(url, forceIncognito = false) {
  const parsedUrl = new URL(url);
  const hostname = parsedUrl.hostname.replace(/^www\./, '');
  const rootDomain = getRootDomain(hostname);
  
  // Buscar pestaña abierta para este dominio
  const allTabs = await chrome.tabs.query({});
  const validTabs = allTabs.filter(t => t.url && !t.url.startsWith('chrome-extension://'));
  const matchingTabs = validTabs.filter(t => t.url.includes(rootDomain));
  // Una captura solicitada como incógnito nunca puede degradarse al perfil
  // normal. Antes se elegía la primera pestaña coincidente y eso podía subir
  // al servidor las cuentas personales de Chrome.
  let tab = forceIncognito
    ? matchingTabs.find(t => t.incognito === true)
    : matchingTabs.find(t => t.incognito !== true) || matchingTabs[0];
  
  // Determinar si debemos extraer de incógnito
  const isIncognito = forceIncognito || tab?.incognito === true;
  
  let storeId = undefined;
  if (isIncognito) {
    const stores = await chrome.cookies.getAllCookieStores();
    const incognitoStore = stores.find(s => s.id !== "0");
    if (incognitoStore) {
      storeId = incognitoStore.id;
    } else {
      return { error: "No se encontró sesión en incógnito. Asegúrate de haberle dado permiso a la extensión para funcionar en Incógnito y de tener la ventana abierta y logueada antes de guardar." };
    }
  }

  // Extraer todas las cookies si es incógnito, si no, solo del dominio
  const cookieMap = new Map();
  for (const domain of getSessionDomains(hostname)) {
    const query = { domain };
    if (storeId) query.storeId = storeId;
    const domainCookies = await chrome.cookies.getAll(query).catch(() => []);
    for (const cookie of domainCookies) {
      cookieMap.set(`${cookie.storeId || storeId || "0"}|${cookie.partitionKey?.topLevelSite || ""}|${cookie.partitionKey?.hasCrossSiteAncestor ? "1" : "0"}|${cookie.domain}|${cookie.path}|${cookie.name}`, cookie);
    }
  }
  let cookies = [...cookieMap.values()];
  // Si no estamos en incógnito, fusionamos con google.com manualmente para servicios de Google
  if (!storeId && (hostname.includes('labs.google') || hostname.includes('youtube.com'))) {
    const googleCookies = await chrome.cookies.getAll({ domain: "google.com" });
    const existingNames = new Set(cookies.map(c => c.name));
    for (const gc of googleCookies) {
      if (!existingNames.has(gc.name)) {
        cookies.push(gc);
      }
    }
  }
  
  let needToClose = false;
  let createdWindowId = null;

  if (!tab) {
    if (isIncognito) {
      const win = await chrome.windows.create({ url: url, incognito: true, focused: false });
      createdWindowId = win.id;
      needToClose = true;
      const tabs = await chrome.tabs.query({ windowId: win.id });
      tab = tabs[0];
    } else {
      // Si no hay ninguna pestaña abierta de ese dominio en normal, no podemos extraer localStorage
      return {
        cookies_json: JSON.stringify(cookies),
        local_storage_json: "{}",
        session_storage_json: "{}"
      };
    }
  }
  
  if (needToClose) {
    await new Promise(resolve => {
      let resolved = false;
      const finish = () => { if (!resolved) { resolved = true; resolve(); } };
      function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') finish();
      }
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(finish, 4000);
      chrome.tabs.get(tab.id, (t) => { if (t && t.status === 'complete') finish(); });
    });
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const ls = { ...localStorage };
      const ss = { ...sessionStorage };
      return { ls, ss, idbData: {} };
    }
  });

  if (needToClose) {
    if (createdWindowId) await chrome.windows.remove(createdWindowId);
    else await chrome.tabs.remove(tab.id);
  }

  const resData = results[0]?.result || { ls: {}, ss: {}, idbData: {} };

  return {
    cookies_json: JSON.stringify(cookies),
    local_storage_json: JSON.stringify(resData.ls),
    session_storage_json: JSON.stringify(resData.ss),
    indexed_db_json: JSON.stringify(resData.idbData || {})
  };
}


