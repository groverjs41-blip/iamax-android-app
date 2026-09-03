import { getDashboardData, getAdminLoginUrl, trackLaunch, downloadSession, uploadSession, loginAsOwner, loginAsClient, signupClient, get2FACodes, getTutorials, getLiveTracking, getReferralSummary, applyReferralCode, redeemReferralReward, getCardSecrets, reportBrokenCard, persistAuthTokens, resolveBotAutoLoginUrl, refreshAccessTokenIfPossible, logoutSession } from "../shared/api.js";
import { getApiBase, setApiBase, setGuestPassword, getOwnerToken, setOwnerToken, setBotEmail, setBotPassword, getBotEmail, getRememberedLoginEmail, setRememberedLoginEmail, setRememberSessionEnabled, clearLocalAuthSession } from "../shared/config.js";
import { sanitizeHexColor, sanitizeCssUrl, isSafeUpdateUrl } from "../shared/sanitize.js";
import { setSessionValues, getSessionValues, removeSessionValues } from "../shared/sessionStore.js";

const BOT_FRONTEND_VERSION = "1.3.5-payments-fix";
const DESKTOP_APP_VERSION = "1.3.9";
const SALES_WHATSAPP_NUMBER = "59175084778";

// Evita abrir dos veces la misma tarjeta mientras permite preparar y mantener
// abiertas varias herramientas distintas en paralelo.
const openingCardIds = new Set();

const state = {
  settings: null,
  categories: [],
  cards: [],
  search: "",
  category: "all",
  isLocked: true,
  isCatalogOnly: false,
  userPlan: "none",
  userEmail: "",
  favorites: []
};
let liveUsersMap = {};
let liveCounterTimer = null;

/** Método de login real de la tarjeta (sin inventar google si no viene). */
function getCardLoginMethod(card) {
  return String(card?.login_method || "").trim().toLowerCase();
}

function isGoogleInjectMethod(card) {
  return getCardLoginMethod(card) === "google";
}

/** Inyectar si hay método usable. Owner siempre; clientes si client_can_inject. */
function canShowInjectButton(card) {
  const method = getCardLoginMethod(card);
  if (method === "none" || method === "disabled" || method === "off" || method === "manual") {
    return false;
  }
  // google | credentials | clerk_* | vacío (credenciales en BD) → sí
  if (state.isOwner) return true;
  return Boolean(card?.client_can_inject);
}

async function savePendingInjectSession(card, extra = {}) {
  const method = getCardLoginMethod(card);
  await setSessionValues({
    clientCanInject: Boolean(card.client_can_inject),
              enableStreaming: Boolean(card.enable_streaming),
    clientInjectMethod: method || "credentials",
    isOwner: Boolean(state.isOwner),
    ...extra
  });
  if (canShowInjectButton(card)) {
    await setSessionValues({ pendingInjectCardId: card.id });
  } else {
    await removeSessionValues(["pendingInjectCardId"]);
  }
}

function normalizeProxyProtocolClient(raw, hostHint = "") {
  const rawS = String(raw || "").toLowerCase();
  const hostS = String(hostHint || "").toLowerCase();
  const blob = `${rawS} ${hostS}`;
  // socks5:// o tipo SOCKS5 — antes que "http" del default del form
  if (/socks5|socks 5|s5\b|socks5h/.test(blob)) return "socks5";
  if (/socks4|socks 4|s4\b|socks4a/.test(blob)) return "socks4";
  // Host IPVanish: nyc.socks.ipvanish.com
  if (/(^|[^a-z])socks([^a-z0-9]|$)/.test(blob) || /\.socks\./.test(hostS) || hostS.includes("socks.")) {
    return "socks5";
  }
  if (rawS.includes("https") || hostS.startsWith("https")) return "https";
  if (rawS.includes("http") || hostS.startsWith("http")) return "http";
  return "http";
}

/**
 * Streaming DRM limpio: SOLO si el owner lo activa en la tarjeta.
 * Nunca automático por URL (evita sorpresas en otros perfiles).
 * fingerprint_config puede venir como objeto o JSON string desde la API.
 */
function parseCardFingerprintConfig(card) {
  let fp = card?.fingerprint_config;
  if (typeof fp === "string") {
    try {
      fp = JSON.parse(fp);
    } catch {
      fp = {};
    }
  }
  return fp && typeof fp === "object" && !Array.isArray(fp) ? fp : {};
}

function cardWantsStreamingDrmClean(card) {
  const fp = parseCardFingerprintConfig(card);
  const fromApi = Boolean(
    card?.streaming_drm_clean
    || card?.streamingDrmClean
    || fp.streaming_drm_clean
    || fp.streamingDrmClean
  );
  if (fromApi) return true;
  // Fallback localStorage (misma sesión Electron) por si la API aún no manda el campo
  try {
    const map = JSON.parse(localStorage.getItem("iamax_streaming_drm_cards") || "{}");
    if (map[String(card?.id)] === true) return true;
  } catch { /* ignore */ }
  return false;
}

/** Guarda preferencia local del botón streaming (Owner + dashboard). */
function rememberStreamingDrmLocal(cardId, enabled) {
  try {
    const key = "iamax_streaming_drm_cards";
    const map = JSON.parse(localStorage.getItem(key) || "{}");
    if (enabled) map[String(cardId)] = true;
    else delete map[String(cardId)];
    localStorage.setItem(key, JSON.stringify(map));
  } catch { /* ignore */ }
}

/**
 * Compat. Lovable: SOLO desde Owner al crear/editar tarjeta (fingerprint_config).
 * NO hay botón en la tarjeta del dashboard (el usuario lo pidió en configuración Owner).
 * Chromium OPEN + --incognito + seed ext + pin Owner + Inject.
 */
function cardWantsLovableCompat(card) {
  try {
    const fp = parseCardFingerprintConfig(card);
    if (
      card?.lovable_compat
      || card?.lovableCompat
      || fp.lovable_compat
      || fp.lovableCompat
    ) {
      return true;
    }
  } catch { /* ignore */ }
  // Cache local escrita al guardar la tarjeta en Owner (misma sesión)
  try {
    const map = JSON.parse(localStorage.getItem("iamax_lovable_compat_cards") || "{}");
    if (map[String(card?.id)] === true) return true;
  } catch { /* ignore */ }
  return false;
}

/**
 * Modo ligero Chromium: Mac Intel viejo / 8GB / Iris Pro (anti SIGABRT).
 * Solo si Owner lo activa en la tarjeta.
 */
function cardWantsChromiumLite(card) {
  try {
    const fp = parseCardFingerprintConfig(card);
    if (
      card?.chromium_lite
      || card?.chromiumLite
      || fp.chromium_lite
      || fp.chromiumLite
      || fp.mac_lite
      || fp.macLite
    ) {
      return true;
    }
  } catch { /* ignore */ }
  try {
    const map = JSON.parse(localStorage.getItem("iamax_chromium_lite_cards") || "{}");
    if (map[String(card?.id)] === true) return true;
  } catch { /* ignore */ }
  return false;
}

async function buildProxyData(card) {
  const proxyData = {
    host: String(card.proxy_host || "").replace(/^(socks5h?|socks4a?|socks|http|https):\/\//i, "").trim(),
    port: card.proxy_port || "",
    username: card.proxy_username || "",
    password: "",
    protocol: normalizeProxyProtocolClient(card.proxy_type || "HTTP", card.proxy_host || "")
  };

  // SIEMPRE pedir secretos si hay host (Peacock/SOCKS). Antes se saltaba si
  // has_proxy_credentials=false y el proxy salía sin password → IP real (Bolivia).
  if (!proxyData.host && !card.has_proxy_credentials) {
    return proxyData;
  }

  try {
    const guestPass = "";
    const ownerToken = await getOwnerToken();
    const secrets = await getCardSecrets(card.id, guestPass, ownerToken);
    const merged = {
      ...proxyData,
      ...(secrets.proxy || {}),
      password: secrets.proxy?.password || secrets.proxy?.pass || proxyData.password || "",
      username: secrets.proxy?.username || secrets.proxy?.user || proxyData.username || ""
    };
    merged.host = String(merged.host || "")
      .replace(/^(socks5h?|socks4a?|socks|http|https):\/\//i, "")
      .trim();
    merged.protocol = normalizeProxyProtocolClient(
      merged.protocol || secrets.proxy?.protocol || secrets.proxy?.type || card.proxy_type || "HTTP",
      merged.host
    );
    if (merged.host && merged.username && !merged.password) {
      console.warn("[Dashboard] Proxy host+user sin password card=", card.id, "— Peacock verá IP real");
    }
    return merged;
  } catch (e) {
    console.warn("[Dashboard] getCardSecrets proxy:", e.message || e);
    return proxyData;
  }
}

async function trackLaunchWithAuth(cardId) {
  const guestPass = "";
  const ownerToken = await getOwnerToken();
  return trackLaunch(cardId, guestPass, ownerToken);
}

function getStaffModeLabel(role, isOwner) {
  if (isOwner || role === "owner") return "MODO OWNER";
  if (role === "supervisor") return "MODO SUPERVISOR";
  if (role === "admin") return "MODO ADMIN";
  return "MODO STAFF";
}

function requiredPlanLabel(card = {}) {
  return String(card.access_level || "standard").trim().toLowerCase() === "ultra"
    ? "ULTRA"
    : "ESTÁNDAR";
}

async function openExternalUrl(url) {
  if (window.iamaxDesktop?.openExternalUrl) {
    const result = await window.iamaxDesktop.openExternalUrl(url);
    if (result?.error) throw new Error(result.error);
    return;
  }
  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (!popup) throw new Error("El sistema bloqueó la apertura del enlace.");
}

async function requestSubscriptionForCard(card = {}) {
  const plan = requiredPlanLabel(card);
  const email = String(state.userEmail || "").trim() || "correo no disponible";
  const toolName = String(card.name || "herramienta IAmax").trim();
  const message = [
    "Hola IAmax, quiero adquirir una suscripción.",
    `Correo registrado: ${email}`,
    `Plan solicitado: ${plan}`,
    `Herramienta seleccionada: ${toolName}`
  ].join("\n");
  const whatsappUrl = `https://wa.me/${SALES_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  try {
    await openExternalUrl(whatsappUrl);
    setFeedback(`Te llevamos a WhatsApp para solicitar el plan ${plan}.`, "info");
  } catch (error) {
    setFeedback(`No se pudo abrir WhatsApp: ${error.message}`, "error");
  }
}

async function requestSubscriptionForModule(name, accessLevel = "standard") {
  return requestSubscriptionForCard({ name, access_level: accessLevel });
}

function buildRoleBadge(role, isOwner, isStaff) {
  if (isOwner || role === "owner") {
    return '<span class="role-badge role-badge-owner" title="Acceso total al workspace">Owner</span>';
  }
  if (role === "supervisor") {
    return '<span class="role-badge role-badge-supervisor" title="Acceso supervisor">Supervisor</span>';
  }
  if (isStaff || role === "admin") {
    return '<span class="role-badge role-badge-admin" title="Acceso administrativo">Admin</span>';
  }
  return "";
}

function highlightLoginProofRole(role) {
  document.querySelectorAll(".login-proof-grid > div").forEach((card) => {
    card.classList.toggle("proof-role-active", card.dataset.roleCard === role);
  });
}

function persistSessionRole(role) {
  if (role) {
    localStorage.setItem("iamax_session_role", role);
  } else {
    localStorage.removeItem("iamax_session_role");
  }
}

function applySessionIdentity(payload = {}) {
  const isOwner = Boolean(payload.isOwner);
  const isStaff = Boolean(payload.isStaff || isOwner);
  const role = payload.role || (isOwner ? "owner" : isStaff ? "admin" : "client");

  state.isOwner = isOwner;
  state.isStaff = isStaff;
  state.role = role;
  state.userPlan = String(payload.userPlan || "none").toLowerCase();
  state.isCatalogOnly = Boolean(payload.catalogOnly);
  // Todos los usuarios autenticados ven únicamente los códigos de las tarjetas
  // que su plan/grupo les asigna. Sólo Owner/Admin pueden editar su origen.
  if (elements.openAuthButton) elements.openAuthButton.hidden = false;

  document.body.classList.toggle("is-owner-session", isOwner);
  document.body.classList.toggle("is-staff-session", isStaff && !isOwner);

  const topBanner = document.querySelector(".top-banner");
  if (topBanner) topBanner.classList.toggle("owner-mode", isOwner);

  const subscriptionTimer = document.getElementById("subscriptionTimer");
  if (subscriptionTimer && isStaff) {
    if (countdownInterval) clearInterval(countdownInterval);
    subscriptionTimer.textContent = getStaffModeLabel(role, isOwner);
  }

  if (elements.userPlanBadge) {
    const roleBadge = buildRoleBadge(role, isOwner, isStaff);
    if (isStaff) {
      elements.userPlanBadge.innerHTML = roleBadge;
    } else if (payload.catalogOnly) {
      elements.userPlanBadge.innerHTML = '<span class="catalog-only-plan-badge">Sin suscripción</span>';
    } else if (payload.userPlan === "ultra") {
      elements.userPlanBadge.innerHTML = `Plan actual: <span style="color:var(--accent-violet);">Ultra</span>`;
    } else if (payload.userPlan === "standard") {
      elements.userPlanBadge.innerHTML = "Plan actual: Estandar";
    } else if (payload.isLocked) {
      elements.userPlanBadge.innerHTML = "Sesion requerida";
    } else {
      elements.userPlanBadge.innerHTML = "Plan activo";
    }
  }

  persistSessionRole(isStaff ? role : "client");
  highlightLoginProofRole(isOwner ? "owner" : "client");
  refreshOwnerPanelButton();
}

function updateLiveBadges() {
  document.querySelectorAll(".live-badge-pc").forEach((badge) => {
    const cardId = badge.dataset.cardId;
    // El heartbeat del servidor es la fuente de verdad; evita “1 en uso” fantasma.
    const activeUsers = Math.max(0, Number(liveUsersMap[cardId] || 0));
    badge.textContent = activeUsers === 1 ? '1 en uso' : activeUsers + ' en uso';
      badge.style.display = 'flex';
  });
}

// ── Badges de estado de sesión (estilo KAIZEN) ────────────────────────────────

function sessionStatusKey(cardId) {
  return `sessionStatus_${cardId}`;
}

async function setSessionStatusCache(cardId, status) {
  if (!cardId) return;
  await chrome.storage.local.set({ [sessionStatusKey(cardId)]: status }).catch(() => {});
}

function applySessionBadgeElement(badge, status) {
  if (!badge) return;
  const hasSession = status === "active";
  badge.classList.remove("hidden", "session-active", "session-empty");
  badge.classList.add(hasSession ? "session-active" : "session-empty");
  badge.textContent = hasSession ? "Con sesión" : "Sin sesión";
  badge.title = hasSession
    ? "Hay una sesión guardada en la nube para esta tarjeta"
    : "Esta tarjeta todavía no tiene una sesión guardada en la nube";
}

function updateSessionBadge(cardId, status) {
  document.querySelectorAll(`.session-status-badge[data-card-id="${CSS.escape(String(cardId))}"]`).forEach((badge) => {
    applySessionBadgeElement(badge, status);
  });
}

function rememberCardSessionStatus(cardId, status) {
  const card = state.cards.find((item) => String(item.id) === String(cardId));
  if (card) card.has_session = status === "active";
  void setSessionStatusCache(cardId, status);
  updateSessionBadge(cardId, status);
}

async function updateAllSessionBadges() {
  const badges = document.querySelectorAll(".session-status-badge[data-card-id]");
  if (!badges.length) return;
  const cardIds = [...new Set([...badges].map((b) => b.dataset.cardId).filter(Boolean))];
  const stored = await chrome.storage.local.get(cardIds.map(sessionStatusKey)).catch(() => ({}));
  const cardsById = new Map(state.cards.map((card) => [String(card.id), card]));
  cardIds.forEach((cardId) => {
    const card = cardsById.get(String(cardId));
    const serverStatus = typeof card?.has_session === "boolean"
      ? (card.has_session ? "active" : "empty")
      : null;
    applySessionBadgeElement(
      document.querySelector(`.session-status-badge[data-card-id="${CSS.escape(String(cardId))}"]`),
      serverStatus || stored[sessionStatusKey(cardId)] || "empty"
    );
  });
}


// ── Fin badges de sesión ───────────────────────────────────────────────────────

async function fetchLiveUsers() {
  try {
    const ownerToken = await getOwnerToken();
    const result = await getLiveTracking(ownerToken);
    if (result.success && result.live) {
      liveUsersMap = result.live;
      updateLiveBadges();
    }
  } catch (error) {
    console.warn("No se pudo actualizar usuarios activos:", error);
  }
}

function setupLiveCounters() {
  if (liveCounterTimer) return;
  void fetchLiveUsers();
  liveCounterTimer = setInterval(() => void fetchLiveUsers(), 3000);
}

function buildBotRedirect(path = "/client/live-chat") {
  const params = new URLSearchParams({
    v: BOT_FRONTEND_VERSION,
    forceMediaUpload: "1",
    cache: String(Date.now())
  });
  return `${path}?${params.toString()}`;
}

function refreshOwnerPanelButton() {
  const openOwnerPanelBtn = document.getElementById("openOwnerPanelBtn");
  const openConfigButton = document.getElementById("openConfigButton");
  const referralCenterButton = document.getElementById("referralCenterButton");
  const canManage = Boolean(state.isOwner);
  const canUseReferrals = !canManage && !state.isLocked;
  openOwnerPanelBtn?.classList.toggle("hidden", !canManage);
  openConfigButton?.classList.toggle("hidden", !canManage);
  referralCenterButton?.classList.toggle("hidden", !canUseReferrals);
  if (!canUseReferrals) document.getElementById("referralClientPanel")?.classList.add("hidden");
}

function mountHeaderUtilities() {
  const actions = document.querySelector(".header-actions");
  if (!actions) return;
  ["reloadAppBtn", "referralCenterButton", "notificationCenter"].forEach((id) => {
    const control = document.getElementById(id);
    if (control && control.parentElement !== actions) actions.appendChild(control);
  });
}

const elements = {
  brandTitle: document.querySelector("#brandTitle"),
  brandSubtitle: document.querySelector("#brandSubtitle"),
  heroTitle: document.querySelector("#heroTitle"),
  heroHeadline: document.querySelector("#heroHeadline"),
  heroText: document.querySelector("#heroText"),
  heroStats: document.querySelector("#heroStats"),
  categoryList: document.querySelector("#categoryList"),
  searchInput: document.querySelector("#searchInput"),
  cardGrid: document.querySelector("#cardGrid"),
  cardTemplate: document.querySelector("#cardTemplate"),
  feedbackBox: document.querySelector("#feedbackBox"),
  globalAnnouncementBanner: document.querySelector("#globalAnnouncementBanner"),
  userPlanBadge: document.querySelector("#userPlanBadge"),
  extensionHero: document.querySelector("#extensionHero"),
  extensionHeroBg: document.querySelector("#extensionHeroBg"),
  extensionHeroKicker: document.querySelector("#extensionHeroKicker"),
  extensionHeroTitle: document.querySelector("#extensionHeroTitle"),
  extensionHeroText: document.querySelector("#extensionHeroText"),
  heroToolTotal: document.querySelector("#heroToolTotal"),
  heroCategoryTotal: document.querySelector("#heroCategoryTotal"),
  heroFeaturedTotal: document.querySelector("#heroFeaturedTotal"),
  openConfigButton: document.querySelector("#openConfigButton"),
  configDialog: document.querySelector("#configDialog"),
  configForm: document.querySelector("#configForm"),
  configTitle: document.querySelector("#configTitle"),
  adminSection: document.querySelector("#adminSection"),
  apiBaseInput: document.querySelector("#apiBaseInput"),

  ownerEmailInput: document.querySelector("#ownerEmailInput"),
  ownerPasswordInput: document.querySelector("#ownerPasswordInput"),
  cancelConfigButton: document.querySelector("#cancelConfigButton"),
  authDialog: document.querySelector("#authDialog"),
  openAuthButton: document.querySelector("#openAuthButton"),
  closeAuthButton: document.querySelector("#closeAuthButton"),
  authList: document.querySelector("#authList"),
  streamingDialog: document.querySelector("#streamingDialog"),
  openStreamingButton: document.querySelector("#openStreamingButton"),
  closeStreamingButton: document.querySelector("#closeStreamingButton"),
  streamingList: document.querySelector("#streamingList"),
  streamingCount: document.querySelector("#streamingCount"),
  metodosDialog: document.querySelector("#metodosDialog"),
  openMetodosButton: document.querySelector("#openMetodosButton"),
  closeMetodosButton: document.querySelector("#closeMetodosButton"),
  metodosList: document.querySelector("#metodosList"),
  metodosCount: document.querySelector("#metodosCount"),
  videoPlayerDialog: document.querySelector("#videoPlayerDialog"),
  closeVideoPlayerButton: document.querySelector("#closeVideoPlayerButton"),
  videoPlayerIframe: document.querySelector("#videoPlayerIframe"),
  videoPlayerTitle: document.querySelector("#videoPlayerTitle"),
  botDialog: document.querySelector("#botDialog"),
  openBotButton: document.querySelector("#openBotButton"),
  openBotWindowButton: document.querySelector("#openBotWindowButton"),
  closeBotButton: document.querySelector("#closeBotButton")
};

function compareVersions(a = "0.0.0", b = "0.0.0") {
  const pa = String(a).split(".");
  const pb = String(b).split(".");
  for (let i = 0; i < 3; i++) {
    const na = Number(pa[i]) || 0;
    const nb = Number(pb[i]) || 0;
    if (na > nb) return 1;
    if (nb > na) return -1;
  }
  return 0;
}

function setupNotificationCenter() {
  const center = document.getElementById("notificationCenter");
  const panel = document.getElementById("notificationPanel");
  const bell = document.getElementById("notificationBell");
  const badge = document.getElementById("notificationBadge");
  const close = document.getElementById("notificationClose");
  const history = document.getElementById("notificationHistory");
  if (!center || center.dataset.ready === "true") return;

  center.dataset.ready = "true";
  bell?.addEventListener("click", () => {
    document.getElementById("referralClientPanel")?.classList.add("hidden");
    panel?.classList.toggle("hidden");
  });
  close?.addEventListener("click", () => {
    panel?.classList.add("hidden");
    badge?.classList.add("hidden");
  });
  history?.addEventListener("click", () => {
    panel?.classList.toggle("history-open");
  });

  if (window.iamaxUpdates?.onProgress) {
    window.iamaxUpdates.onProgress((progress) => {
      const percent = Math.max(0, Math.min(100, Number(progress?.percent || 0)));
      const progressBox = document.getElementById("notificationProgress");
      const progressFill = document.getElementById("notificationProgressFill");
      const progressLabel = document.getElementById("notificationProgressLabel");
      progressBox?.classList.remove("hidden");
      if (progressFill) progressFill.style.width = `${percent}%`;
      if (progressLabel) progressLabel.textContent = `${Math.round(percent)}%`;
    });
  }

  if (window.iamaxUpdates?.onStatus) {
    window.iamaxUpdates.onStatus((state) => {
      renderUpdaterState(state);
    });
  }
  hideUpdateNotification();
}

function hideUpdateNotification() {
  document.getElementById("notificationCenter")?.classList.remove("hidden");
  document.getElementById("notificationPanel")?.classList.add("hidden");
  document.getElementById("notificationBadge")?.classList.add("hidden");
  document.getElementById("notificationEmpty")?.classList.remove("hidden");
  document.getElementById("notificationLabel")?.classList.add("hidden");
  document.getElementById("notificationUpdateCard")?.classList.add("hidden");
}

function renderUpdaterState(state) {
  const action = document.getElementById("notificationUpdateAction");
  const install = document.getElementById("notificationInstallAction");
  const progressBox = document.getElementById("notificationProgress");
  const progressFill = document.getElementById("notificationProgressFill");
  const progressLabel = document.getElementById("notificationProgressLabel");

  // Banner top elements (visible before login)
  const banner = document.getElementById("updateBanner");
  const bannerAction = document.getElementById("updateBannerLink");
  const bannerInstall = document.getElementById("installUpdateButton");
  const bannerProgressBox = document.getElementById("updateProgress");
  const bannerProgressFill = document.getElementById("updateProgressFill");
  const bannerProgressLabel = document.getElementById("updateProgressLabel");
  const bannerClose = document.getElementById("closeUpdateBanner");

  if (!state?.status) return;

  if (state.status === "no-update") {
    hideUpdateNotification();
    if (banner) banner.classList.add("hidden");
    return;
  }

  if (banner) banner.classList.remove("hidden");
  if (bannerClose) {
    bannerClose.onclick = () => banner.classList.add("hidden");
  }

  if (state.status === "checking") {
    if (action) { action.disabled = true; action.textContent = "Buscando..."; }
    if (bannerAction) { bannerAction.disabled = true; bannerAction.textContent = "Buscando..."; }
    return;
  }

  if (state.status === "available") {
    if (action) { action.disabled = false; action.textContent = "Actualizar ahora"; }
    if (bannerAction) { bannerAction.disabled = false; bannerAction.textContent = "Actualizar ahora"; }
    return;
  }

  if (state.status === "downloading") {
    const percent = Math.max(0, Math.min(100, Number(state.progress?.percent || 0)));

    if (action) { action.disabled = true; action.textContent = "Descargando..."; }
    if (progressBox) progressBox.classList.remove("hidden");
    if (progressFill) progressFill.style.width = `${percent}%`;
    if (progressLabel) progressLabel.textContent = `${Math.round(percent)}%`;

    if (bannerAction) { bannerAction.disabled = true; bannerAction.textContent = "Descargando..."; }
    if (bannerProgressBox) bannerProgressBox.classList.remove("hidden");
    if (bannerProgressFill) bannerProgressFill.style.width = `${percent}%`;
    if (bannerProgressLabel) bannerProgressLabel.textContent = `${Math.round(percent)}%`;
    return;
  }

  if (state.status === "downloaded") {
    if (action) action.classList.add("hidden");
    if (progressBox) progressBox.classList.add("hidden");
    if (install) install.classList.remove("hidden");

    if (bannerAction) bannerAction.classList.add("hidden");
    if (bannerProgressBox) bannerProgressBox.classList.add("hidden");
    if (bannerInstall) bannerInstall.classList.remove("hidden");
    return;
  }
}

function showUpdateNotification({ latestVersion, updateLabel, updateUrl, releaseNotes }) {
  const center = document.getElementById("notificationCenter");
  const panel = document.getElementById("notificationPanel");
  const badge = document.getElementById("notificationBadge");
  const empty = document.getElementById("notificationEmpty");
  const label = document.getElementById("notificationLabel");
  const card = document.getElementById("notificationUpdateCard");
  const title = document.getElementById("notificationTitle");
  const list = document.getElementById("notificationList");
  const action = document.getElementById("notificationUpdateAction");
  const install = document.getElementById("notificationInstallAction");

  const banner = document.getElementById("updateBanner");
  const bannerText = document.getElementById("updateBannerText");
  const bannerAction = document.getElementById("updateBannerLink");
  const bannerInstall = document.getElementById("installUpdateButton");

  if (!center || !card) return;

  if (updateLabel && label) label.textContent = updateLabel;
  if (latestVersion && title) title.textContent = `Novedades de la versión ${latestVersion}`;
  if (bannerText && latestVersion) bannerText.textContent = `Hay una nueva versión de IAmax disponible (${latestVersion}).`;

  if (list && Array.isArray(releaseNotes)) {
    list.innerHTML = "";
    releaseNotes.forEach(note => {
      if (!note) return;
      const li = document.createElement("li");
      li.textContent = note;
      list.appendChild(li);
    });
  }

  empty?.classList.add("hidden");
  label?.classList.remove("hidden");
  card?.classList.remove("hidden");
  if (banner) banner.classList.remove("hidden");

  const handleUpdateClick = async () => {
    if (window.iamaxUpdates?.download) {
      if (action) { action.disabled = true; action.textContent = "Buscando..."; }
      if (bannerAction) { bannerAction.disabled = true; bannerAction.textContent = "Buscando..."; }
      try {
        const status = await window.iamaxUpdates.check?.();
        renderUpdaterState(status);
        if (status?.status === "no-update") return;
        if (status?.status === "error") {
          throw new Error(status.error || "No se pudo comprobar la actualizacion.");
        }
        if (status?.status === "downloaded") {
          return;
        }
        if (status?.status !== "available" && status?.status !== "downloading") {
          throw new Error("No hay una actualizacion lista para descargar.");
        }
        const downloadState = await window.iamaxUpdates.download();
        renderUpdaterState(downloadState);
        if (downloadState?.status === "error") {
          throw new Error(downloadState.error || "No se pudo descargar la actualizacion.");
        }
      } catch (error) {
        if (action) { action.disabled = false; action.textContent = "Reintentar"; }
        if (bannerAction) { bannerAction.disabled = false; bannerAction.textContent = "Reintentar"; }
        console.error("No se pudo descargar la actualizacion:", error);
      }
      return;
    }
    if (isSafeUpdateUrl(updateUrl)) window.open(updateUrl, "_blank", "noopener");
  };

  if (action) action.onclick = handleUpdateClick;
  if (bannerAction) bannerAction.onclick = handleUpdateClick;

  if (install) install.onclick = () => window.iamaxUpdates?.install?.();
  if (bannerInstall) bannerInstall.onclick = () => window.iamaxUpdates?.install?.();

  center.classList.remove("hidden");
  panel.classList.remove("hidden");
  badge.classList.remove("hidden");
}

function getEmbedUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtube.com") || parsed.hostname.includes("youtu.be")) {
      let videoId = "";
      if (parsed.hostname.includes("youtu.be")) {
        videoId = parsed.pathname.substring(1);
      } else {
        videoId = parsed.searchParams.get("v");
      }
      if (videoId) return `https://www.youtube.com/embed/${videoId}?autoplay=1`;
    }
  } catch(e) {}
  return url;
}

async function getBotLaunchUrl() {
  try {
    return await resolveBotAutoLoginUrl("/client/live-chat");
  } catch {
    return null;
  }
}

function getVisibleCards() {
  const filtered = state.cards.filter((card) => {
    const slug = String(card.category_slug);
    if (slug === "streaming" || slug === "metodos") return false;

    const isFav = state.favorites.includes(card.id);
    const matchesCategory = state.category === "all" || slug === state.category || (state.category === "favorites" && isFav);
    const haystack = `${card.name} ${card.category_name} ${card.notes}`.toLowerCase();
    const matchesSearch = !state.search || haystack.includes(state.search);
    return matchesCategory && matchesSearch;
  });

  return filtered.sort((a, b) => {
    const aFav = state.favorites.includes(a.id) ? 1 : 0;
    const bFav = state.favorites.includes(b.id) ? 1 : 0;
    if (aFav !== bFav) return bFav - aFav;
    return 0; // maintain original sort
  });
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

function referralStatusText(status) {
  const value = String(status || "").toUpperCase();
  if (value === "REQUESTED") return "En espera";
  if (value === "APPROVED") return "Aprobado";
  if (value === "DELIVERED") return "Entregado";
  if (value === "REJECTED") return "Rechazado";
  return value || "Pendiente";
}

function setReferralClientMessage(message = "", isError = false) {
  const element = document.getElementById("referralClientMessage");
  if (!element) return;
  element.textContent = message;
  element.style.color = isError ? "#fda4af" : "#67e8f9";
}

function renderClientReferrals(payload) {
  if (!payload?.client) return;
  const code = payload.client.referral_code || "SIN CODIGO";
  const credits = Number(payload.client.referral_credits || 0);
  const codeElement = document.getElementById("referralClientCode");
  const creditsElement = document.getElementById("referralClientCredits");
  const rewardsElement = document.getElementById("referralClientRewards");
  const historyElement = document.getElementById("referralClientHistory");
  const notificationsElement = document.getElementById("referralClientNotifications");
  if (codeElement) codeElement.textContent = code;
  if (creditsElement) creditsElement.textContent = String(credits);

  const rewards = Array.isArray(payload.rewards) ? payload.rewards : [];
  if (rewardsElement) {
    rewardsElement.innerHTML = rewards.length
      ? rewards.map((reward) => {
        const disabled = credits < Number(reward.credits || 0);
        return `
          <article class="referral-client-reward">
            <div>
              <strong>${escapeHtml(reward.label || "Premio")}</strong>
              <small>${Number(reward.credits || 0)} creditos · ${escapeHtml(reward.description || "Entrega desde el panel")}</small>
            </div>
            <button class="referral-reward-redeem" type="button" data-referral-reward="${escapeHtml(reward.key || "")}" ${disabled ? "disabled" : ""}>Canjear</button>
          </article>
        `;
      }).join("")
      : '<div class="referral-empty">Todavia no hay premios disponibles.</div>';
  }

  const history = Array.isArray(payload.redemptions) ? payload.redemptions : [];
  if (historyElement) {
    historyElement.innerHTML = history.length
      ? history.slice(0, 8).map((item) => `
        <article class="referral-client-history-row">
          <div>
            <strong>${escapeHtml(item.reward_label || "Premio")}</strong>
            <small>${Number(item.credits || 0)} creditos</small>
          </div>
          <strong>${escapeHtml(referralStatusText(item.status))}</strong>
        </article>
      `).join("")
      : '<div class="referral-empty">Aun no realizaste canjes.</div>';
  }

  const notifications = Array.isArray(payload.notifications) ? payload.notifications : [];
  if (notificationsElement) {
    notificationsElement.innerHTML = notifications.length
      ? notifications.slice(0, 6).map((notification) => `
        <article class="referral-client-notification ${notification.read_at ? "" : "is-new"}">
          <strong>${escapeHtml(notification.title || "Aviso")}</strong>
          <small>${escapeHtml(notification.body || "")}</small>
        </article>
      `).join("")
      : '<div class="referral-empty">No tienes avisos nuevos.</div>';
  }

  if (payload.referrer?.email) {
    setReferralClientMessage(`Invitado por ${payload.referrer.email}.`);
  } else {
    setReferralClientMessage("Puedes aplicar un codigo una sola vez.");
  }
}

async function loadClientReferrals() {
  if (state.isOwner || state.isLocked) return;
  const token = await getOwnerToken();
  if (!token) return;
  try {
    renderClientReferrals(await getReferralSummary(token));
  } catch (error) {
    setReferralClientMessage(error.message || "No se pudieron cargar los referidos.", true);
  }
}

function setupReferralCenter() {
  const button = document.getElementById("referralCenterButton");
  const panel = document.getElementById("referralClientPanel");
  const close = document.getElementById("closeReferralPanelButton");
  const copy = document.getElementById("copyReferralClientCode");
  const applyForm = document.getElementById("referralClientApplyForm");
  const input = document.getElementById("referralClientInput");
  const rewards = document.getElementById("referralClientRewards");
  if (!button || button.dataset.ready === "true") return;
  button.dataset.ready = "true";

  button.addEventListener("click", async () => {
    if (state.isOwner || state.isLocked) return;
    const opening = panel?.classList.contains("hidden");
    panel?.classList.toggle("hidden");
    document.getElementById("notificationPanel")?.classList.add("hidden");
    if (opening) await loadClientReferrals();
  });
  close?.addEventListener("click", () => panel?.classList.add("hidden"));
  copy?.addEventListener("click", async () => {
    const code = document.getElementById("referralClientCode")?.textContent || "";
    if (!code || code === "SIN CODIGO") return;
    await navigator.clipboard.writeText(code);
    setReferralClientMessage("Codigo copiado.");
  });
  applyForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const token = await getOwnerToken();
    const code = String(input?.value || "").trim();
    if (!token || !code) return;
    try {
      const result = await applyReferralCode(token, code);
      if (input) input.value = "";
      setReferralClientMessage(result.message || "Codigo aplicado.");
      await loadClientReferrals();
    } catch (error) {
      setReferralClientMessage(error.message || "No se pudo aplicar el codigo.", true);
    }
  });
  rewards?.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-referral-reward]");
    if (!target || target.disabled) return;
    if (!confirm("Confirmar canje de este premio?")) return;
    const token = await getOwnerToken();
    try {
      const result = await redeemReferralReward(token, target.dataset.referralReward);
      setReferralClientMessage(result.message || "Canje solicitado.");
      await loadClientReferrals();
    } catch (error) {
      setReferralClientMessage(error.message || "No se pudo realizar el canje.", true);
    }
  });
}

function setFeedback(message = "", type = "info", opts = {}) {
  if (!elements.feedbackBox) return;
  if (!message && opts.percent == null && opts.countdownSec == null) {
    elements.feedbackBox.classList.add("hidden");
    elements.feedbackBox.textContent = "";
    elements.feedbackBox.innerHTML = "";
    elements.feedbackBox.removeAttribute("data-type");
    return;
  }

  elements.feedbackBox.classList.remove("hidden");
  elements.feedbackBox.dataset.type = type || "info";

  const percent = opts.percent != null ? Math.max(0, Math.min(100, Number(opts.percent) || 0)) : null;
  const elapsedSec = opts.elapsedMs != null
    ? Math.max(0, Math.round(Number(opts.elapsedMs) / 1000))
    : (opts.elapsedSec != null ? Number(opts.elapsedSec) : null);
  const countdown = opts.countdownSec != null ? Math.max(0, Number(opts.countdownSec)) : null;

  if (percent != null || countdown != null) {
    const pctLabel = percent != null ? `${Math.round(percent)}%` : "";
    const timeLabel = countdown != null
      ? `⏱ ${countdown}s`
      : (elapsedSec != null ? `⏱ ${elapsedSec}s` : "");
    const barColor = type === "error"
      ? "#ff4d6a"
      : (type === "success" || percent === 100 ? "#00e68a" : "#00e5ff");
    const safeMsg = String(message || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    elements.feedbackBox.innerHTML = `
      <div class="session-save-progress" role="status" aria-live="polite">
        <div class="session-save-progress__row">
          <span class="session-save-progress__msg">${safeMsg}</span>
          <span class="session-save-progress__meta">${[pctLabel, timeLabel].filter(Boolean).join(" · ")}</span>
        </div>
        <div class="session-save-progress__track">
          <div class="session-save-progress__fill" style="width:${percent != null ? percent : 0}%;background:${barColor}"></div>
        </div>
      </div>`;
  } else {
    elements.feedbackBox.textContent = message;
  }
}

/** Cuenta cookies con name+value en un jar de sesión (dashboard). */
function countSessionCookiesLocal(sessionData) {
  try {
    const raw = sessionData?.cookies_json;
    const list = typeof raw === "string" ? JSON.parse(raw || "[]") : (Array.isArray(raw) ? raw : []);
    if (!Array.isArray(list)) return 0;
    return list.filter((c) => c && c.name && String(c.value ?? "").length > 0).length;
  } catch {
    return 0;
  }
}

/**
 * Tras subir: re-descarga del servidor y comprueba que el jar está de verdad.
 * No confía solo en HTTP 200 del upload.
 */
async function verifySessionUploaded(cardId, token, expectedCookies = 0) {
  const guestPass = (await getSessionValues(["guestPassword"]))?.guestPassword || "";
  await new Promise((r) => setTimeout(r, 400));
  const jar = await downloadSession(cardId, guestPass, token);
  const n = countSessionCookiesLocal(jar);
  if (!jar || jar.error || n < 1) {
    return {
      ok: false,
      verified: false,
      cookieCount: n,
      error: jar?.error || `Nube sin cookies usables (${n})`
    };
  }
  if (expectedCookies >= 3 && n < Math.max(1, Math.floor(expectedCookies * 0.5))) {
    return {
      ok: false,
      verified: false,
      cookieCount: n,
      error: `Subimos ~${expectedCookies} cookies pero la nube solo tiene ${n}`
    };
  }
  return { ok: true, verified: true, cookieCount: n, error: "" };
}

function updateCloudBadge(cardId, { text, state = "busy" } = {}) {
  try {
    const badge = document.querySelector(`.session-cloud-badge[data-card-id="${String(cardId)}"]`);
    if (!badge) return;
    badge.textContent = text || "Nube —";
    badge.dataset.state = state;
    badge.classList.remove("hidden");
  } catch (e) { /* ignore */ }
}

function progressDirectionLabel(stage = "", message = "") {
  const s = `${stage} ${message}`.toLowerCase();
  // Apertura / restore de jar = inyección (no "bajando cookies")
  if (/download|bajad|descarg|restor|sembr|inject|inyect/.test(s)) return "Inyectando";
  // Solo subida manual (Guardar sesión) — autosave no llega a UI
  if (/upload|subid|guard|extract|verify|verific/.test(s)) return "Subiendo";
  return "Nube";
}

/** Temporizador post-apertura: espera login y habilita "Guardar sesión". */
const sessionSaveCountdowns = new Map();
/** cardId → true cuando el contador terminó y se puede subir con Guardar. */
const sessionSaveReady = new Map();

function setUploadSessionButtonEnabled(cardId, enabled, label) {
  const id = String(cardId || "");
  if (!id) return;
  document.querySelectorAll(`.upload-session-btn[data-card-id="${id}"]`).forEach((btn) => {
    btn.disabled = !enabled;
    if (label != null) btn.textContent = label;
    btn.title = enabled
      ? "Subir la sesión de este perfil a la nube"
      : "Espera el contador (inicia sesión si hace falta) y luego guarda";
  });
}

function stopSessionSaveCountdown(cardId) {
  const id = String(cardId || "");
  if (!id) return;
  const t = sessionSaveCountdowns.get(id);
  if (t) {
    clearInterval(t);
    sessionSaveCountdowns.delete(id);
  }
}

/**
 * Tras abrir el perfil: contador para que inicies sesión.
 * Solo al llegar a 0 se habilita "Guardar sesión" → "Sesión subida".
 */
function startSessionSaveCountdown(card, totalSec = 30) {
  const cardId = card?.id != null ? String(card.id) : "";
  const name = String(card?.name || "herramienta").slice(0, 28);
  if (!cardId) return;
  stopSessionSaveCountdown(cardId);
  sessionSaveReady.set(cardId, false);
  setUploadSessionButtonEnabled(cardId, false, `Espera ${Math.max(5, Number(totalSec) || 30)}s`);

  let left = Math.max(5, Number(totalSec) || 30);
  const total = left;
  setFeedback(
    `${name}: inicia sesión en el perfil. Contador para poder Guardar…`,
    "info",
    { percent: 5, countdownSec: left }
  );
  updateCloudBadge(cardId, { text: `Guardar en ${left}s`, state: "busy" });

  const timer = setInterval(() => {
    left -= 1;
    const doneRatio = 1 - left / total;
    const percent = Math.min(95, Math.round(8 + doneRatio * 87));
    if (left <= 0) {
      stopSessionSaveCountdown(cardId);
      sessionSaveReady.set(cardId, true);
      setUploadSessionButtonEnabled(cardId, true, "Guardar sesión");
      setFeedback(
        `${name}: contador listo. Pulsa «Guardar sesión» para subir a la nube.`,
        "success",
        { percent: 100, countdownSec: 0 }
      );
      updateCloudBadge(cardId, { text: "Listo para Guardar", state: "ok" });
      return;
    }
    setFeedback(
      `${name}: inicia sesión y espera… luego pulsa Guardar sesión`,
      "info",
      { percent, countdownSec: left }
    );
    updateCloudBadge(cardId, { text: `Guardar en ${left}s`, state: "busy" });
    setUploadSessionButtonEnabled(cardId, false, `Espera ${left}s`);
  }, 1000);
  sessionSaveCountdowns.set(cardId, timer);
}

function wireSessionSaveProgressListener() {
  if (window.__iamaxSessionSaveProgressWired) return;
  window.__iamaxSessionSaveProgressWired = true;
  try {
    if (window.iamaxDesktop?.onSessionSaveProgress) {
      window.iamaxDesktop.onSessionSaveProgress((payload) => {
        if (!payload) return;
        const stage = String(payload.stage || "");
        // Auto-guardado en segundo plano: NO pinta la barra (solo Guardar manual)
        if (/autosave/i.test(stage)) return;

        const pct = Number(payload.percent);
        const msg = payload.message || stage || "Sincronizando sesión…";
        const dir = progressDirectionLabel(stage, msg);
        const isHardDone = payload.done === true;
        const isInjectStage = /inject|download|bajad|restor|sembr|open/i.test(stage + msg);
        const isUploadStage = /upload|subid|extract|guard/i.test(stage + msg);
        const type = isHardDone
          ? (payload.success ? "success" : "error")
          : "info";
        // Solo al terminar una SUBIDA manual se corta el contador (no al inyectar)
        if (isHardDone && payload.success && payload.cardId && isUploadStage && !isInjectStage) {
          stopSessionSaveCountdown(payload.cardId);
          sessionSaveReady.set(String(payload.cardId), true);
          setUploadSessionButtonEnabled(payload.cardId, true, "Guardar sesión");
        }
        // Mientras corre el contador de "espera para Guardar", no pises con eventos de inyección tardíos
        if (sessionSaveCountdowns.has(String(payload.cardId || "")) && isInjectStage) {
          return;
        }
        setFeedback(msg, type, {
          percent: Number.isFinite(pct) ? pct : (isHardDone ? (payload.success ? 100 : 0) : 50),
          elapsedMs: payload.elapsedMs
        });
        try {
          const cardId = String(payload.cardId || "");
          if (!cardId) return;
          if (isHardDone && payload.success) {
            updateCloudBadge(cardId, {
              text: isInjectStage
                ? `Sesión inyectada ${Math.round(pct || 100)}%`
                : `Sesión subida ${Math.round(pct || 100)}%`,
              state: "ok"
            });
          } else if (isHardDone && (payload.error || !payload.success)) {
            updateCloudBadge(cardId, {
              text: isInjectStage ? "Sin sesión en nube" : "Error al subir",
              state: "err"
            });
          } else if (!isHardDone) {
            updateCloudBadge(cardId, {
              text: `${dir} ${Math.round(pct || 0)}%`,
              state: "busy"
            });
          }
        } catch (e) { /* ignore */ }
      });
    }
  } catch (e) { /* ignore */ }
}

// Activar listener de progreso lo antes posible
try { wireSessionSaveProgressListener(); } catch (e) { /* ignore */ }

const SESSION_EXPIRED_MESSAGE = "Tu sesion expiro. Inicia sesion nuevamente.";
const SUBSCRIPTION_EXPIRED_MESSAGE = "Tu suscripcion expiro. Renueva tu suscripcion para volver a ingresar.";
const ACCESS_ERROR_CODES = new Set([
  "AUTH_REQUIRED",
  "TOKEN_EXPIRED",
  "TOKEN_INVALID",
  "SESSION_EXPIRED",
  "SUBSCRIPTION_EXPIRED",
  "ACCOUNT_INACTIVE",
  "ACCESS_DENIED"
]);

function isPastDate(value) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time <= Date.now();
}

function getAccessErrorMessage(error) {
  if (error?.code === "SUBSCRIPTION_EXPIRED") return SUBSCRIPTION_EXPIRED_MESSAGE;
  if (error?.code === "ACCOUNT_INACTIVE") return error.message || "Tu cuenta esta inactiva. Contacta al administrador.";
  if (error?.status === 401 || error?.code === "TOKEN_EXPIRED" || error?.code === "TOKEN_INVALID") return SESSION_EXPIRED_MESSAGE;
  return error?.message || "No tienes acceso.";
}

async function forceLogin(message = SESSION_EXPIRED_MESSAGE) {
  await setOwnerToken("");
  state.isLocked = true;
  state.isCatalogOnly = false;
  state.userPlan = "none";
  state.userEmail = "";
  state.isOwner = false;
  state.isStaff = false;
  state.role = null;
  state.cards = [];
  state.categories = [];
  document.body.classList.remove("is-owner-session", "is-staff-session");
  document.querySelector(".top-banner")?.classList.remove("owner-mode");
  highlightLoginProofRole(localStorage.getItem("iamax_session_role") === "owner" ? "owner" : "");
  refreshOwnerPanelButton();
  if (countdownInterval) clearInterval(countdownInterval);

  const loginOverlay = document.getElementById("loginOverlay");
  if (loginOverlay) {
    loginOverlay.classList.remove("hidden");
    loginOverlay.style.display = "flex";
  }
  if (loginError) {
    loginError.textContent = message;
    loginError.style.display = "block";
    loginError.style.background = "rgba(248, 113, 113, 0.12)";
    loginError.style.borderColor = "rgba(248, 113, 113, 0.45)";
    loginError.style.color = "#fecaca";
  }
  if (elements.userPlanBadge) elements.userPlanBadge.innerHTML = "Sesion requerida";
  setFeedback(message, "error");
  renderCategories();
  renderCards();
}

async function handleAccessError(error) {
  const msg = error.message.toLowerCase();
  if (
    msg.includes("token_expired") ||
    msg.includes("token_invalid") ||
    msg.includes("sesion expirada") ||
    msg.includes("sesión expirada") ||
    msg.includes("sesion ha expirado") ||
    msg.includes("sesión ha expirado") ||
    msg.includes("401")
  ) {
    await forceLogin(SESSION_EXPIRED_MESSAGE);
    return true;
  }
  return false;
}

async function showProfileLoading() {
  if (!window.iamaxDesktop?.showProfileLoading) return null;
  try {
    const response = await window.iamaxDesktop.showProfileLoading();
    return response?.loadingWindowId || null;
  } catch (error) {
    console.warn("No se pudo mostrar la pantalla de carga:", error);
    return null;
  }
}

async function closeProfileLoading(loadingWindowId) {
  if (!window.iamaxDesktop?.closeProfileLoading) return;
  try {
    // Sin id → main cierra todas las ventanas de carga (evita bloqueo de clics)
    await window.iamaxDesktop.closeProfileLoading(loadingWindowId ?? null);
  } catch (error) {
    console.warn("No se pudo cerrar la pantalla de carga:", error);
  }
}

async function getPresenceClientId() {
  const stored = await chrome.storage.local.get(["deviceId", "presenceClientId"]);
  const clientId = stored.deviceId || stored.presenceClientId
    || `desktop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  if (!stored.deviceId && !stored.presenceClientId) {
    await chrome.storage.local.set({ presenceClientId: clientId });
  }
  return clientId;
}

function renderHero() {
  const settings = state.settings || {};
  const totalCards = state.cards.length;
  const totalCategories = state.categories.length;
  const featured = state.cards.filter((card) => card.is_featured).length;
  const logo = document.getElementById("sidebarLogo");

  if (settings.logo_url) {
    if (logo) {
      logo.src = settings.logo_url;
      logo.style.display = "block";
    }
  } else {
    if (logo) {
      logo.removeAttribute("src");
      logo.style.display = "";
    }
    if (elements.brandTitle) elements.brandTitle.textContent = settings.title || "IAmax Dashboard";
  }

  if (elements.extensionHeroKicker) {
    elements.extensionHeroKicker.textContent = settings.hero_title || settings.subtitle || "IAmax Workspace";
  }
  if (elements.extensionHeroTitle) {
    elements.extensionHeroTitle.textContent = settings.hero_headline || settings.title || "Tu centro de herramientas premium";
  }
  if (elements.extensionHeroText) {
    elements.extensionHeroText.textContent = settings.hero_text || "Perfiles, sesiones y accesos organizados en un panel visual, elegante y vivo.";
  }
  if (elements.heroToolTotal) elements.heroToolTotal.textContent = totalCards.toLocaleString("es");
  if (elements.heroCategoryTotal) elements.heroCategoryTotal.textContent = totalCategories.toLocaleString("es");
  if (elements.heroFeaturedTotal) elements.heroFeaturedTotal.textContent = featured.toLocaleString("es");

  const heroCard = state.cards.find((card) => card.banner_base64 || card.logo_base64);
  const heroWallpaper = sanitizeCssUrl(heroCard?.banner_base64 || heroCard?.logo_base64 || settings.background_url || "");
  if (elements.extensionHeroBg) {
    elements.extensionHeroBg.style.background = heroWallpaper
      ? `linear-gradient(90deg, rgba(3, 6, 18, 0.92), rgba(22, 28, 72, 0.58)), url("${heroWallpaper}") center/cover no-repeat`
      : `linear-gradient(135deg, rgba(112, 74, 255, 0.55), rgba(28, 99, 255, 0.38))`;
  }

  document.body.style.backgroundImage = "";
  document.body.style.backgroundSize = "";
  document.body.style.backgroundPosition = "";
  document.body.style.backgroundAttachment = "";
  const workspaceWallpaper = sanitizeCssUrl(settings.background_url);
  if (workspaceWallpaper) {
    document.body.style.setProperty("--workspace-wallpaper", `url("${workspaceWallpaper}")`);
    document.body.classList.add("has-workspace-wallpaper");
  } else {
    document.body.style.removeProperty("--workspace-wallpaper");
    document.body.classList.remove("has-workspace-wallpaper");
  }
}

function renderCategories() {
  elements.categoryList.innerHTML = "";

  const fragment = document.createDocumentFragment();

  // Botón "Todas"
  const allButton = document.createElement("button");
  allButton.type = "button";
  allButton.className = `nav-category ${state.category === "all" ? "active" : ""}`;
  allButton.textContent = "TODAS";
  allButton.addEventListener("click", () => {
    state.category = "all";
    if (window.activateClientView) window.activateClientView("defaultView");
    renderCategories();
    renderCards();
  });
  fragment.appendChild(allButton);

  if (state.favorites.length > 0) {
    const favButton = document.createElement("button");
    favButton.type = "button";
    favButton.className = `nav-category ${state.category === "favorites" ? "active" : ""}`;
    favButton.textContent = "FAVORITOS";
    favButton.addEventListener("click", () => {
      state.category = "favorites";
      if (window.activateClientView) window.activateClientView("defaultView");
      renderCategories();
      renderCards();
    });
    fragment.appendChild(favButton);
  }

  state.categories.forEach((category) => {
    if (category.slug === "streaming" || category.slug === "metodos") return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `nav-category ${state.category === category.slug ? "active" : ""}`;
    button.textContent = category.name.toUpperCase();
    button.addEventListener("click", () => {
      state.category = category.slug;
      if (window.activateClientView) window.activateClientView("defaultView");
      renderCategories();
      renderCards();
    });
    fragment.appendChild(button);
  });

  elements.categoryList.appendChild(fragment);
}

function renderCards() {
  const visibleCards = getVisibleCards();
  elements.cardGrid.innerHTML = "";

  if (state.isLocked) {
    // Ya no limpiamos el DOM, mostramos las tarjetas pero las bloqueamos al hacer click
  }

  if (!visibleCards.length) {
    const categoryLabel = state.category === "all"
      ? "todas las categorias"
      : state.category === "favorites"
        ? "favoritos"
        : state.categories.find((category) => category.slug === state.category)?.name || "este filtro";
    elements.cardGrid.innerHTML = `
      <section class="empty-state-panel">
        <div class="empty-state-glow"></div>
        <p class="eyebrow">Sin resultados</p>
        <h2>No hay herramientas visibles en ${escapeHtml(categoryLabel)}.</h2>
        <p class="muted">Prueba otra categoria, limpia la busqueda o revisa desde el panel owner que las tarjetas esten activas y asignadas a tu plan.</p>
        <div class="empty-state-actions">
          <button class="iamax-btn primary" id="clearFiltersButton" type="button">Ver todas</button>
          <button class="iamax-btn" id="clearSearchButton" type="button">Limpiar busqueda</button>
        </div>
      </section>
    `;
    document.querySelector("#clearFiltersButton")?.addEventListener("click", () => {
      state.category = "all";
      state.search = "";
      if (elements.searchInput) elements.searchInput.value = "";
      renderCategories();
      renderCards();
    });
    document.querySelector("#clearSearchButton")?.addEventListener("click", () => {
      state.search = "";
      if (elements.searchInput) elements.searchInput.value = "";
      renderCards();
    });
    return;
  }

  const fragment = document.createDocumentFragment();
  const groupedCards = new Map();

  visibleCards.forEach((card) => {
    const groupName = state.category === "favorites" ? "Favoritos" : (card.category_name || card.category || "General");
    if (!groupedCards.has(groupName)) {
      groupedCards.set(groupName, []);
    }
    groupedCards.get(groupName).push(card);
  });

  groupedCards.forEach((cards, groupName) => {
    const section = document.createElement("section");
    section.className = "catalog-section";

    const firstCard = cards.find((card) => card.banner_base64 || card.logo_base64) || cards[0];
    const wallpaper = sanitizeCssUrl(firstCard?.banner_base64 || firstCard?.logo_base64 || "");
    section.innerHTML = `
      <div class="section-heading">
        <div>
          <p class="eyebrow">${cards.length} herramientas</p>
          <h2>${escapeHtml(groupName)}</h2>
        </div>
      </div>
      <div class="section-wallpaper"></div>
      <div class="catalog-grid"></div>
    `;

    const sectionWallpaper = section.querySelector(".section-wallpaper");
    sectionWallpaper.style.background = wallpaper
      ? `linear-gradient(90deg, rgba(8, 15, 31, 0.88), rgba(8, 15, 31, 0.48)), url("${wallpaper}") center/cover no-repeat`
      : `linear-gradient(135deg, ${sanitizeHexColor(firstCard?.accent, "#1c63ff")}, ${sanitizeHexColor(firstCard?.secondary_accent, "#704aff")})`;

    const grid = section.querySelector(".catalog-grid");

    cards.forEach((card, index) => {
      const cardElement = createCardElement(card);
      prepareCardMotion(cardElement, index);
      grid.appendChild(cardElement);
    });

    fragment.appendChild(section);
  });

  elements.cardGrid.appendChild(fragment);
  void updateAllSessionBadges();
  activateScrollMotion(elements.cardGrid);
}

function prepareCardMotion(cardElement, index = 0) {
  cardElement.style.setProperty("--motion-delay", `${Math.min(index * 70, 420)}ms`);

  cardElement.addEventListener("pointermove", (event) => {
    if (window.matchMedia("(max-width: 768px)").matches) return;
    const rect = cardElement.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    cardElement.classList.add("is-tilting");
    cardElement.style.transform = `translateY(-6px) rotateX(${(-y * 4).toFixed(2)}deg) rotateY(${(x * 5).toFixed(2)}deg)`;
  });

  cardElement.addEventListener("pointerleave", () => {
    cardElement.classList.remove("is-tilting");
    cardElement.style.transform = "";
  });
}

function activateScrollMotion(root = document) {
  const cards = [...root.querySelectorAll(".iamax-card, .catalog-section, .empty-state-panel")];
  if (!("IntersectionObserver" in window)) {
    cards.forEach((card) => card.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12 });

  cards.forEach((card) => observer.observe(card));
}

function prepareWorkspaceDialog(dialog, countText = "") {
  if (!dialog) return;
  const header = dialog.querySelector(".workspace-modal-header, .auth-card > div:first-child, .config-dialog-content > h3");
  if (!header) return;

  if (!header.querySelector(".workspace-count")) {
    const count = document.createElement("span");
    count.className = "workspace-count";
    header.insertBefore(count, header.lastElementChild);
  }

  const count = header.querySelector(".workspace-count");
  if (count) count.textContent = countText;
}

function createCardElement(card) {
    const template = elements.cardTemplate.content.cloneNode(true);
    const article = template.querySelector(".iamax-card");
    const banner = template.querySelector(".iamax-wallpaper");
    article.style.setProperty("--card-accent", sanitizeHexColor(card.accent, "#7c4dff"));
    article.style.setProperty("--card-accent-2", sanitizeHexColor(card.secondary_accent, "#0f5df5"));

    const cardWallpaper = sanitizeCssUrl(card.banner_base64 || card.logo_base64 || "");
    if (cardWallpaper) {
      banner.style.backgroundImage = `url("${cardWallpaper}")`;
    } else {
      banner.style.background = `linear-gradient(135deg, ${sanitizeHexColor(card.accent, "#704aff")}, ${sanitizeHexColor(card.secondary_accent, "#1c63ff")})`;
    }


    template.querySelector(".tool-category").textContent = card.category_name || "General";
    template.querySelector(".tool-name").textContent = card.name;
    template.querySelector(".tool-notes").textContent = card.notes || "Acceso directo listo para abrir.";
    const liveBadge = template.querySelector(".live-badge-pc");
    const cloudBadge = template.querySelector(".session-cloud-badge");
    if (cloudBadge) {
      cloudBadge.dataset.cardId = String(card.id);
    }
    if (liveBadge) {
      liveBadge.dataset.cardId = String(card.id);
      const activeUsers = Math.max(0, Number(liveUsersMap[card.id] ?? card.activeUsers ?? 0));
      liveBadge.textContent = activeUsers === 1 ? '1 en uso' : activeUsers + ' en uso';
      liveBadge.style.display = 'flex';
    }
    const sessionBadge = template.querySelector(".session-status-badge");
    if (sessionBadge) {
      sessionBadge.dataset.cardId = String(card.id);
      applySessionBadgeElement(sessionBadge, card.has_session === true ? "active" : "empty");
    }
    const catalogLocked = Boolean(state.isCatalogOnly || card.catalog_only);
    const subscriptionOverlay = template.querySelector(".subscription-lock-overlay");
    if (catalogLocked && subscriptionOverlay) {
      article.classList.add("subscription-locked-card");
      article.setAttribute("role", "button");
      article.setAttribute("tabindex", "0");
      article.setAttribute("aria-label", `${card.name}. Requiere plan ${requiredPlanLabel(card)}.`);
      subscriptionOverlay.classList.remove("hidden");
      subscriptionOverlay.setAttribute("aria-hidden", "false");
      const planText = subscriptionOverlay.querySelector(".subscription-lock-plan");
      if (planText) planText.textContent = `PLAN ${requiredPlanLabel(card)}`;
      if (liveBadge?.parentElement) liveBadge.parentElement.style.display = "none";
    }
    const actions = template.querySelector(".iamax-actions");
    const optionsBtn = template.querySelector(".options-btn");
    optionsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (catalogLocked) {
        void requestSubscriptionForCard(card);
        return;
      }
      actions.classList.toggle("hidden");
      article.classList.toggle("expanded");
      optionsBtn.textContent = actions.classList.contains("hidden") ? "Opciones" : "Ocultar";
    });


    const favBtn = template.querySelector(".fav-btn");
    if (state.favorites.includes(card.id)) {
      favBtn.style.opacity = "1";
      favBtn.style.filter = "grayscale(0%)";
    } else {
      favBtn.style.opacity = "0.3";
      favBtn.style.filter = "grayscale(100%)";
    }

    const tutorialBtn = template.querySelector(".tutorial-btn");
    if (card.tutorial_url) {
      tutorialBtn.classList.remove("hidden");
      tutorialBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (elements.videoPlayerDialog && elements.videoPlayerIframe) {
          elements.videoPlayerIframe.src = getEmbedUrl(card.tutorial_url);
          if (elements.videoPlayerTitle) elements.videoPlayerTitle.innerHTML = `<svg style="width:24px;height:24px;color:var(--accent-red, #ff4d4d);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg> Tutorial: ${escapeHtml(card.name)}`;
          elements.videoPlayerDialog.showModal();
        } else {
          window.open(card.tutorial_url, "_blank");
        }
      });
    }

    favBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (state.favorites.includes(card.id)) {
        state.favorites = state.favorites.filter(id => id !== card.id);
        if (state.category === "favorites" && state.favorites.length === 0) {
          state.category = "all";
        }
      } else {
        state.favorites.push(card.id);
      }
      await chrome.storage.local.set({ favorites: state.favorites });
      renderCategories();
      renderCards();
    });

    const reportBtn = template.querySelector(".report-btn");
    const injectBtn = template.querySelector(".inject-card-btn");
    const clearLocalBtn = template.querySelector(".clear-local-btn");
    const showClearCacheButton = Boolean(state.isOwner);
    // Sin botón Aislar/incógnito: cada cardId = Chromium aislado en disco.

    if (card.requires_session === false) {
      reportBtn.style.display = "none";
    }
    if (catalogLocked) {
      reportBtn.style.display = "none";
      injectBtn.style.display = "none";
      clearLocalBtn.style.display = "none";
    }

    if (showClearCacheButton) {
      clearLocalBtn.classList.remove("hidden");
      clearLocalBtn.style.display = "";
      clearLocalBtn.textContent = "Limpiar perfil";
    } else {
      clearLocalBtn.style.display = "none";
    }

    // Quitar botón residual "Compat. Lovable" de tarjetas (solo se configura en Owner)
    if (actions) {
      actions.querySelectorAll(".lovable-compat-btn").forEach((el) => {
        try { el.remove(); } catch { /* ignore */ }
      });
    }

    // Inyectar SIEMPRE visible si hay método usable (credenciales cuando cookie falla)
    if (!canShowInjectButton(card)) {
      injectBtn.style.display = "none";
    } else {
      injectBtn.style.display = "";
      injectBtn.classList.remove("hidden");
      injectBtn.title = "Inyectar credenciales (email/pass/TOTP) si la cookie no entra";
    }

    injectBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!canShowInjectButton(card)) {
        setFeedback("Esta tarjeta no usa método Google; la inyección no aplica.", "error");
        return;
      }
      setFeedback("Enviando comando de inyección automática...", "info");

      try {
        await savePendingInjectSession(card);
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: "AUTO_INJECT_NOW", cardId: card.id }, resolve);
        });

        if (response && response.success) {
          setFeedback("¡Credenciales inyectadas con éxito en la ventana abierta!", "success");
        } else {
          setFeedback("Asegúrate de tener la ventana de Google abierta antes de inyectar.", "error");
        }
      } catch (err) {
        setFeedback("Error al intentar inyectar: " + err.message, "error");
      }
    });

    reportBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm("¿Quieres reportar esta herramienta? El bot intentará iniciar sesión automáticamente para arreglarla en tiempo real. Esto puede tardar 1 minuto.")) {
        setFeedback("Reportando... Por favor espera, el bot está trabajando en recuperar la sesión...", "warning");
        try {
          const guestPass = "";
          const ownerToken = await getOwnerToken();
          const result = await reportBrokenCard(card.id, guestPass, ownerToken);
          if (result.success) {
            setFeedback(result.message || "¡Sesión restaurada! Recarga la página para usar la herramienta.", "success");
          } else {
            setFeedback("Error: " + (result.message || "No se pudo recuperar automáticamente."), "error");
          }
        } catch (err) {
          setFeedback("Error de red al intentar reportar la tarjeta.", "error");
        }
      }
    });

    article.addEventListener("click", async () => {
      if (catalogLocked) {
        await requestSubscriptionForCard(card);
        return;
      }
      const openingKey = String(card.id || card.url || card.name || "unknown");
      if (openingCardIds.has(openingKey)) {
        setFeedback("Esta herramienta ya se está abriendo…", "info");
        return;
      }
      openingCardIds.add(openingKey);
      updateLiveBadges();
      const tOpen = Date.now();
      // Flujo: Inyectar sesión (nube → perfil) con % · luego contador · Guardar manual
      setFeedback("Abriendo perfil…", "info", { percent: 5, elapsedMs: 0 });
      updateCloudBadge(card.id, { text: "Inyectando 5%", state: "busy" });
      // Hacemos que la carga se sienta instantánea omitiendo la ventana de splash
      let loadingWindowId = null;

      // TODAS las tools: Chromium individual por cardId (aislamiento real, no incógnito).
      let finalOpenAs = String(card.open_as || "popup").replace(/^incognito_/, "") || "popup";
      if (finalOpenAs !== "tab" && finalOpenAs !== "full") finalOpenAs = "popup";

      try {
        setFeedback("Preparando perfil e inyección de sesión…", "info", {
          percent: 15,
          elapsedMs: Date.now() - tOpen
        });
        updateCloudBadge(card.id, { text: "Inyectando 15%", state: "busy" });
        const prep = await Promise.all([
          buildProxyData(card),
          getPresenceClientId(),
          savePendingInjectSession(card, {
            verificationCompatibility: Boolean(card.verification_compatibility)
          }).catch(() => {}),
          (async () => {
            if (!card.blocked_selectors) return;
            try {
              const urlObj = new URL(card.url);
              await new Promise((resolve) => {
                chrome.runtime.sendMessage({
                  type: "SET_BLOCKED_SELECTORS",
                  domain: urlObj.hostname,
                  selectors: card.blocked_selectors
                }, resolve);
              });
            } catch (e) { /* ignore */ }
          })()
        ]);
        const proxyData = prep[0];
        const presenceClientId = prep[1];

        setFeedback("Inyectando sesión desde la nube…", "info", {
          percent: 40,
          elapsedMs: Date.now() - tOpen
        });
        updateCloudBadge(card.id, { text: "Inyectando 40%", state: "busy" });

        let openResult = null;
        if (card.requires_session === false) {
          openResult = await new Promise((resolve) => {
            chrome.runtime.sendMessage({
              type: "CLEAR_AND_OPEN",
              loadingWindowId,
              presenceClientId,
              cardId: card.id,
              url: card.url,
              openAs: finalOpenAs,
              enableIncognitoRestart: false,
              enableClearCacheBtn: Boolean(card.clear_cache_button) && !cardWantsStreamingDrmClean(card),
              proxyData: proxyData,
              userAgent: card.user_agent,
              acceptLanguage: card.accept_language,
              webrtcMode: card.webrtc_mode,
              verificationCompatibility: Boolean(card.verification_compatibility) || cardWantsLovableCompat(card),
              streamingDrmClean: cardWantsStreamingDrmClean(card),
              lovableCompat: cardWantsLovableCompat(card),
              chromiumLite: cardWantsChromiumLite(card),
              assignedExtensions: cardWantsStreamingDrmClean(card) ? [] : (card.assigned_extensions || []),
              loginMethod: getCardLoginMethod(card),
              clientCanInject: Boolean(card.client_can_inject),
              enableStreaming: Boolean(card.enable_streaming),
              isOwner: Boolean(state.isOwner),
              dontClearCookies: false
            }, resolve);
          });
          if (cardWantsStreamingDrmClean(card)) {
            rememberStreamingDrmLocal(card.id, true);
            console.log("[Dashboard] Streaming → Edge IAmax aislado card=", card.id);
          }
          if (cardWantsLovableCompat(card)) {
            console.log("[Dashboard] Compat. Lovable ON → Chromium OPEN + Incognito + ext + inject card=", card.id);
          }
          if (cardWantsChromiumLite(card)) {
            console.log("[Dashboard] Modo ligero Chromium ON (Mac viejo / 8GB) card=", card.id);
          }
        } else {
          // fetchSession: main baja SOLO la sesión del servidor. Streaming → Edge IAmax aislado.
          const wantsDrm = cardWantsStreamingDrmClean(card);
          const wantsLovableCompat = cardWantsLovableCompat(card);
          const wantsChromiumLite = cardWantsChromiumLite(card);
          if (wantsDrm) {
            rememberStreamingDrmLocal(card.id, true);
            console.log("[Dashboard] Streaming → Edge IAmax aislado card=", card.id);
          }
          if (wantsLovableCompat) {
            console.log("[Dashboard] Compat. Lovable ON → Chromium OPEN + Incognito + ext + inject card=", card.id);
          }
          if (wantsChromiumLite) {
            console.log("[Dashboard] Modo ligero Chromium ON (Mac viejo / 8GB) card=", card.id);
          }
          openResult = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
              type: "INJECT_SESSION",
              loadingWindowId,
              presenceClientId,
              cardId: card.id,
              url: card.url,
              sessionData: null,
              fetchSession: true,
              openAs: finalOpenAs,
              enableIncognitoRestart: false,
              enableClearCacheBtn: Boolean(card.clear_cache_button) && !wantsDrm,
              proxyData: proxyData,
              userAgent: card.user_agent,
              acceptLanguage: card.accept_language,
              webrtcMode: card.webrtc_mode,
              verificationCompatibility: Boolean(card.verification_compatibility) || wantsLovableCompat,
              streamingDrmClean: wantsDrm,
              lovableCompat: wantsLovableCompat,
              chromiumLite: wantsChromiumLite,
              assignedExtensions: wantsDrm ? [] : (card.assigned_extensions || []),
              loginMethod: getCardLoginMethod(card),
              clientCanInject: Boolean(card.client_can_inject),
              enableStreaming: Boolean(card.enable_streaming),
              isOwner: Boolean(state.isOwner)
            }, response => {
              if (chrome.runtime.lastError) {
                return reject(new Error("Fallo de comunicación con la extensión: " + chrome.runtime.lastError.message));
              }
              if (response && response.error) reject(new Error(response.error));
              else resolve(response || {});
            });
          });
        }

        trackLaunchWithAuth(card.id).catch(() => {});
        const nDown = Number(openResult?.cookieCount) || 0;
        const restored = Boolean(openResult?.sessionRestored || openResult?.sessionVerified);
        const elapsedOpen = Date.now() - tOpen;
        if (restored && nDown > 0) {
          setFeedback(
            `✓ Sesión inyectada (${nDown} cookies, ${Math.round(elapsedOpen / 1000)}s)`,
            "success",
            { percent: 100, elapsedMs: elapsedOpen }
          );
          updateCloudBadge(card.id, {
            text: `Sesión inyectada 100%`,
            state: "ok"
          });
          rememberCardSessionStatus(card.id, "active");
        } else {
          setFeedback(
            openResult?.message || openResult?.downloadError
              || "Perfil abierto sin sesión en nube. Inicia sesión y espera el contador para Guardar.",
            "info",
            { percent: 100, elapsedMs: elapsedOpen }
          );
          updateCloudBadge(card.id, {
            text: "Sin sesión — inicia login",
            state: "err"
          });
          // Que esta apertura no haya restaurado cookies no significa que la
          // copia compartida haya desaparecido. El servidor es la fuente de verdad.
          if (card.has_session === true) {
            updateSessionBadge(card.id, "active");
          } else {
            rememberCardSessionStatus(card.id, "empty");
          }
        }
        // Contador: inicia sesión → al llegar a 0 se habilita Guardar sesión
        startSessionSaveCountdown(card, 30);
      } catch (error) {
        console.warn("Error abriendo perfil:", error);
        if (await handleAccessError(error)) return;
        const msg = String(error?.message || error || "desconocido");
        if (msg.includes("ERR_FAILED")) {
          alert("Error de Red o Proxy: " + msg);
          setFeedback("Fallo de red o proxy.", "error", { percent: 0, elapsedMs: Date.now() - tOpen });
          return;
        }
        // Mensajes claros para clientes que se quedan en "cargando"
        if (/navegador|chromium|timeout|antivirus|reinstala/i.test(msg)) {
          alert(
            "No se pudo abrir el navegador de IAmax.\n\n" +
            msg +
            "\n\nSuele pasar por:\n" +
            "• Antivirus bloqueando chrome.exe embebido\n" +
            "• Instalación incompleta (falta carpeta browser)\n" +
            "• Descarga del motor colgada sin internet\n\n" +
            "Solución: reinstala IAmax-1.3.4-Setup.exe y agrega excepción en el antivirus."
          );
        }
        setFeedback("Error al abrir: " + msg, "error", {
          percent: 0,
          elapsedMs: Date.now() - tOpen
        });
      } finally {
        openingCardIds.delete(openingKey);
        // Cierra animación (main también la cierra al spawn; por si acaso)
        await closeProfileLoading(loadingWindowId);
      }
    });
    article.addEventListener("keydown", (event) => {
      if (!catalogLocked || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      void requestSubscriptionForCard(card);
    });

    const uploadBtn = template.querySelector(".upload-session-btn");

    clearLocalBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!state.isOwner) return;
      if (!confirm(`¿Limpiar PERFIL de ${card.name}?\n\nEsto SÍ borra la cuenta/cookies del disco (no es solo "Borrar caché").\nCierra Chromium y elimina también el perfil Lovable captcha-clean.`)) return;
      setFeedback("Limpiando perfil (cuenta + disco)...", "warning");

      await removeSessionValues(["pendingInjectCardId"]);
      // Limpiar perfil â‰  borrar caché
      try {
        await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: "CLEAR_CARD_PROFILE", cardId: card.id }, resolve);
        });
      } catch (err) {
        console.warn("CLEAR_CARD_PROFILE:", err);
      }
      const proxyData = await buildProxyData(card);
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: "CLEAR_AND_OPEN",
          cardId: card.id,
          url: card.url,
          openAs: card.open_as,
          enableIncognitoRestart: false,
          enableClearCacheBtn: Boolean(card.clear_cache_button) && !cardWantsStreamingDrmClean(card),
          dontClearCookies: false,
          skipAutoInject: true,
          streamingDrmClean: cardWantsStreamingDrmClean(card),
          lovableCompat: cardWantsLovableCompat(card),
          chromiumLite: cardWantsChromiumLite(card),
          assignedExtensions: cardWantsStreamingDrmClean(card) ? [] : (card.assigned_extensions || []),
          proxyData: proxyData,
          userAgent: card.user_agent,
          acceptLanguage: card.accept_language,
          webrtcMode: card.webrtc_mode,
          verificationCompatibility: Boolean(card.verification_compatibility),
          loginMethod: getCardLoginMethod(card)
        }, resolve);
      });
      rememberCardSessionStatus(card.id, "empty");
      setFeedback("Perfil limpio. La cuenta debería pedir login de cero.", "success");
    });

    getOwnerToken().then(token => {
      if (state.isOwner && token) {
        uploadBtn.classList.remove("hidden");
        uploadBtn.dataset.cardId = String(card.id);
        // Por defecto listo (si no hubo apertura en esta sesión); tras abrir, el contador lo bloquea
        if (!sessionSaveReady.has(String(card.id))) {
          sessionSaveReady.set(String(card.id), true);
        }
        setUploadSessionButtonEnabled(
          card.id,
          sessionSaveReady.get(String(card.id)) !== false,
          "Guardar sesión"
        );

        uploadBtn.addEventListener("click", async (e) => {
          e.stopPropagation(); // Evitar que se abra la tarjeta
          const cardKey = String(card.id);
          // Solo subir cuando el contador de post-login terminó (o no hay contador activo)
          if (sessionSaveCountdowns.has(cardKey) || sessionSaveReady.get(cardKey) === false) {
            setFeedback(
              "Espera a que termine el contador (inicia sesión en el perfil) y luego pulsa Guardar sesión.",
              "warning",
              { percent: 0 }
            );
            return;
          }
          const t0 = Date.now();
          stopSessionSaveCountdown(card.id);
          uploadBtn.disabled = true;
          const origLabel = "Guardar sesión";
          uploadBtn.textContent = "0%…";
          // Avance UI mientras main extrae/sube/verifica (IPC también emite % real)
          let fake = 8;
          const fakeTimer = setInterval(() => {
            fake = Math.min(75, fake + 3);
            uploadBtn.textContent = `${fake}%`;
            setFeedback("Subiendo sesión a la nube…", "info", {
              percent: fake,
              elapsedMs: Date.now() - t0
            });
            updateCloudBadge(card.id, { text: `Subiendo ${fake}%`, state: "busy" });
          }, 400);
          setFeedback("Subiendo sesión (extraer + subir + verificar)…", "info", {
            percent: 5,
            elapsedMs: 0
          });
          updateCloudBadge(card.id, { text: "Subiendo 5%", state: "busy" });
          try {
            // Main: extrae, sube y RE-DESCARGA para verificar de verdad
            const cloud = await new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({
                type: "SAVE_SESSION_TO_CLOUD",
                url: card.url,
                cardId: card.id
              }, response => {
                if (chrome.runtime.lastError) {
                  return reject(new Error("Fallo de comunicación: " + chrome.runtime.lastError.message));
                }
                if (response && response.error) reject(new Error(response.error));
                else resolve(response || {});
              });
            });
            clearInterval(fakeTimer);
            // Skip / éxito falso: no marcar verde si el servidor no guardó o es Guest
            if (cloud && (cloud.skipped || cloud.error)) {
              throw new Error(cloud.error || cloud.message || "El servidor no guardó la sesión");
            }
            if (cloud && cloud.success && cloud.verified !== false) {
              const n = Number(cloud.cookieCount) || 0;
              // Solo rechazar jars vacíos reales (0 cookies). Flow Ultra puede guardar con pocas cookies WP.
              if (n < 1) {
                throw new Error(
                  `Subida incompleta (${n} cookies). Deja el perfil ABIERTO con sesión (tu nombre) y vuelve a Guardar.`
                );
              }
              const sec = cloud.elapsedMs != null
                ? Math.round(cloud.elapsedMs / 1000)
                : Math.round((Date.now() - t0) / 1000);
              uploadBtn.textContent = "100% ✓";
              setFeedback(
                `✓ Sesión subida (${n} cookies, ${sec}s)`,
                "success",
                { percent: 100, elapsedMs: cloud.elapsedMs || (Date.now() - t0) }
              );
              updateCloudBadge(card.id, {
                text: `Sesión subida 100%`,
                state: "ok"
              });
              rememberCardSessionStatus(card.id, "active");
              setTimeout(() => { uploadBtn.textContent = origLabel; uploadBtn.disabled = false; }, 2200);
              return;
            }
            if (cloud && cloud.success && cloud.verified === false) {
              // Subió pero main no verificó: re-check desde dashboard
              setFeedback("Comprobando en la nube…", "info", {
                percent: 90,
                elapsedMs: Date.now() - t0
              });
              uploadBtn.textContent = "90%…";
              const check = await verifySessionUploaded(
                card.id,
                token,
                Number(cloud.cookieCount) || 0
              );
              if (!check.ok) {
                throw new Error(check.error || "Subida no verificada en la nube");
              }
              uploadBtn.textContent = "100% ✓";
              setFeedback(
                `✓ Sesión subida (${check.cookieCount} cookies)`,
                "success",
                { percent: 100, elapsedMs: Date.now() - t0 }
              );
              updateCloudBadge(card.id, {
                text: `Sesión subida 100%`,
                state: "ok"
              });
              rememberCardSessionStatus(card.id, "active");
              setTimeout(() => { uploadBtn.textContent = origLabel; uploadBtn.disabled = false; }, 2200);
              return;
            }
            // Fallback: extract + upload + verify real (re-download)
            setFeedback("Reintentando subida (50%)…", "info", { percent: 50, elapsedMs: Date.now() - t0 });
            uploadBtn.textContent = "50%…";
            updateCloudBadge(card.id, { text: "Subiendo 50%", state: "busy" });
            const sessionData = await new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({
                type: "EXTRACT_SESSION",
                url: card.url,
                cardId: card.id
              }, response => {
                if (chrome.runtime.lastError) return reject(new Error("Fallo de comunicación: " + chrome.runtime.lastError.message));
                if (response && response.error) reject(new Error(response.error));
                else resolve(response);
              });
            });
            const expected = countSessionCookiesLocal(sessionData);
            setFeedback(`Subiendo sesión (80%)…`, "info", {
              percent: 80,
              elapsedMs: Date.now() - t0
            });
            uploadBtn.textContent = "80%…";
            await uploadSession(card.id, sessionData, token);
            setFeedback("Verificando en la nube…", "info", {
              percent: 92,
              elapsedMs: Date.now() - t0
            });
            uploadBtn.textContent = "92%…";
            const check = await verifySessionUploaded(card.id, token, expected);
            if (!check.ok) {
              throw new Error(check.error || "El servidor no tiene la sesión (verificación fallida)");
            }
            uploadBtn.textContent = "100% ✓";
            setFeedback(
              `✓ Sesión subida (${check.cookieCount} cookies, ${Math.round((Date.now() - t0) / 1000)}s)`,
              "success",
              { percent: 100, elapsedMs: Date.now() - t0 }
            );
            updateCloudBadge(card.id, {
              text: `Sesión subida 100%`,
              state: "ok"
            });
              rememberCardSessionStatus(card.id, "active");
            setTimeout(() => { uploadBtn.textContent = origLabel; uploadBtn.disabled = false; }, 2200);
          } catch (error) {
            clearInterval(fakeTimer);
            uploadBtn.textContent = "Error";
            setFeedback("Error al subir la sesión: " + error.message, "error", {
              percent: 0,
              elapsedMs: Date.now() - t0
            });
            updateCloudBadge(card.id, { text: "Error al subir", state: "err" });
            setTimeout(() => { uploadBtn.textContent = origLabel; uploadBtn.disabled = false; }, 2500);
          }
        });

      }
    });

    return template.firstElementChild;
}

let countdownInterval = null;

function startSubscriptionCountdown(element, expiresAtStr) {
  if (countdownInterval) clearInterval(countdownInterval);

  const expiresDate = new Date(expiresAtStr).getTime();

  const updateTimer = () => {
    const now = new Date().getTime();
    const distance = expiresDate - now;

    if (distance <= 0) {
      clearInterval(countdownInterval);
      element.textContent = "Expirada";
      element.style.color = "var(--accent-red, #ff4d4d)";
      forceLogin(SUBSCRIPTION_EXPIRED_MESSAGE);
      return;
    }

    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);

    element.textContent = `${days}d ${hours}h ${minutes}m ${seconds}s`;
  };

  updateTimer();
  countdownInterval = setInterval(updateTimer, 1000);
}

async function openBotFullscreen() {
  const botUrl = await resolveBotAutoLoginUrl("/client/live-chat");
  if (window.iamaxDesktop?.openBotWindow) {
    const result = await window.iamaxDesktop.openBotWindow(botUrl);
    if (result?.error) throw new Error(result.error);
    return;
  }
  const popup = window.open(botUrl, "_blank", "noopener,noreferrer");
  if (!popup) window.location.href = botUrl;
}

async function loadDashboard() {
  try {
    setFeedback("");
    const ownerToken = await getOwnerToken();
    const payload = await getDashboardData("", ownerToken);
    if (!payload.isOwner && !payload.catalogOnly && isPastDate(payload.expiresAt)) {
      await forceLogin(SUBSCRIPTION_EXPIRED_MESSAGE);
      return;
    }
    state.settings = payload.settings || {};
    state.categories = Array.isArray(payload.categories) ? payload.categories : [];
    state.cards = Array.isArray(payload.cards) ? payload.cards : [];
    state.isLocked = payload.isLocked || false;
    state.isCatalogOnly = Boolean(payload.catalogOnly);
    state.userPlan = String(payload.userPlan || "none").toLowerCase();
    applySessionIdentity(payload);

    const subscriptionTimer = document.getElementById("subscriptionTimer");
    if (subscriptionTimer && !state.isStaff) {
      if (payload.expiresAt) {
        startSubscriptionCountdown(subscriptionTimer, payload.expiresAt);
      } else {
        if (countdownInterval) clearInterval(countdownInterval);
        subscriptionTimer.textContent = "Ilimitado";
      }
    }

    if (payload.settings && payload.settings.global_announcement) {
      elements.globalAnnouncementBanner.textContent = payload.settings.global_announcement;
      elements.globalAnnouncementBanner.classList.remove("hidden");
    } else {
      elements.globalAnnouncementBanner.classList.add("hidden");
    }

    renderHero();
    renderCategories();
    renderCards();
    void fetchLiveUsers();

    if (state.isCatalogOnly) {
      setFeedback("Catálogo habilitado. Elige una herramienta para solicitar el plan Estándar o Ultra por WhatsApp.", "info");
    } else if (state.isLocked) {
      setFeedback("El dashboard está protegido. Inicia sesión para ver las tarjetas.", "error");
    }
  } catch (error) {
    if (await handleAccessError(error)) return;
    setFeedback(`No se pudo cargar el dashboard: ${error.message}`, "error");
  }
}

function wireEvents() {
  setupReferralCenter();

  elements.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderCards();
  });

  async function hydrateConfigForm() {
    if (elements.apiBaseInput) {
      elements.apiBaseInput.value = await getApiBase();
      elements.apiBaseInput.readOnly = true;
      elements.apiBaseInput.title = "Backend de produccion fijado para esta version.";
    }
    if (elements.ownerEmailInput) elements.ownerEmailInput.value = "";
    if (elements.ownerPasswordInput) elements.ownerPasswordInput.value = "";
  }

  window.activateClientView = function(targetId) {
    const views = [
      "configDialog",
      "authDialog",
      "streamingDialog",
      "metodosDialog",
      "botDialog"
    ];

    const mainEls = [elements.extensionHero, elements.cardGrid, elements.feedbackBox];

    views.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        if (id === targetId) {
          el.classList.remove('hidden');
        } else {
          el.classList.add('hidden');
        }
      }
    });

    if (targetId === "defaultView") {
      mainEls.forEach(el => el?.classList.remove("hidden"));
    } else {
      mainEls.forEach(el => el?.classList.add("hidden"));
    }
  };

  elements.openConfigButton?.addEventListener("click", async () => {
    if (!state.isOwner) return;
    await hydrateConfigForm();
    window.activateClientView("configDialog");
  });

  const logoutBtn = document.getElementById("logoutButton");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        logoutBtn.disabled = true;
        await logoutSession();
      } catch (error) {
        console.warn("[Logout] Error al cerrar sesion:", error);
        await clearLocalAuthSession();
      } finally {
        window.location.reload();
      }
    });
  }

  const closeConfigDialog = () => {
    window.activateClientView("defaultView");
  };

  elements.cancelConfigButton?.addEventListener("click", closeConfigDialog);
  document.querySelector("#cancelConfigButtonAlt")?.addEventListener("click", closeConfigDialog);

  elements.configForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const ownerEmail = elements.ownerEmailInput?.value.trim() || "";
    const ownerPassword = elements.ownerPasswordInput?.value || "";
    try {
      if (ownerEmail && ownerPassword) {
        const loginData = await loginAsOwner(ownerEmail, ownerPassword);
        if (loginData.mustSetup2fa) {
          await setSessionValues({ iamax_must_setup_2fa: "1" });
        } else {
          await removeSessionValues(["iamax_must_setup_2fa"]);
        }
        await setOwnerToken(loginData.token);
      }

      closeConfigDialog();
      setFeedback("Configuracion guardada.", "success");
      await loadDashboard();
    } catch (error) {
      setFeedback("No se pudo guardar la configuracion: " + error.message, "error");
    }
  });



  // Authenticator Logic
  let authInterval = null;
  let authLocalTimer = null;
  let currentAuthRemaining = 0;

  async function fetchAndRenderAuth() {
    try {
      const guestPass = "";
      const ownerToken = await getOwnerToken();
      const data = await get2FACodes(guestPass, ownerToken);

      if (!data.success || !data.codes) throw new Error("No success");

      currentAuthRemaining = data.remaining;
      prepareWorkspaceDialog(elements.authDialog, `${data.codes.length} codigos`);

      if (data.codes.length === 0) {
        elements.authList.innerHTML = '<p class="muted" style="text-align:center;">No tienes tarjetas con 2FA disponible.</p>';
        return;
      }

      const renderCode = (card, sectionType) => {
        const progressPct = (currentAuthRemaining / 30) * 100;
        const color = currentAuthRemaining <= 5 ? "var(--accent-red, #ff4d4d)":"var(--accent-cyan)";
        const hasCode = card.code && card.code !== "------";
        const isEmailCode = sectionType === "email";
        const sourceLabel = isEmailCode ? "Correo electrónico" : "Authenticator";
        const visibleCode = hasCode
          ? (data.canViewCodes ? escapeHtml(card.code) : "******")
          : (isEmailCode ? "Esperando código…" : "Sin código");

        return `
          <div class="auth-item">
            <div class="auth-item-header">
              <span>${escapeHtml(card.name)}</span>
              <span class="auth-source-badge auth-source-${escapeHtml(card.code_source || "credentials")}">${sourceLabel}</span>
            </div>
            <div class="auth-item-code" style="color: ${color}">
              <span>${visibleCode}</span>
              ${hasCode && !isEmailCode ? `<span class="auth-item-time" id="time-${card.id}">${currentAuthRemaining}s</span>` : ''}
            </div>
            ${isEmailCode ? `<div class="auth-email-meta">${escapeHtml(card.login_email || "")} · ${hasCode ? "recibido recientemente" : "esperando un correo con código"}</div>` : ''}
            <div class="auth-action-row">
              ${(data.canViewCodes && hasCode) ? `<button class="iamax-btn ghost copy-code-btn" data-card-id="${card.id}" type="button">Copiar código</button>` : ''}
            </div>
            ${hasCode && !isEmailCode ? `
            <div class="auth-progress-bg">
              <div class="auth-progress-bar" id="prog-${card.id}" style="width: ${progressPct}%; background: ${color};"></div>
            </div>` : ''}
          </div>
        `;
      };

      const authenticatorCodes = data.codes.filter(card => card.code_source === "totp");
      const emailCodes = data.codes.filter(card => card.code_source === "email" || card.code_source === "email_waiting");
      const empty = (message) => `<div class="auth-section-empty">${message}</div>`;
      elements.authList.innerHTML = `
        <section class="auth-code-section auth-code-section-totp">
          <header class="auth-section-header">
            <div><span class="auth-section-kicker">Aplicación</span><h4>Authenticator</h4></div>
            <span class="auth-section-count">${authenticatorCodes.length}</span>
          </header>
          <div class="auth-section-grid">
            ${authenticatorCodes.length ? authenticatorCodes.map(card => renderCode(card, "totp")).join("") : empty("El Owner todavía no agregó claves TOTP con nombre.")}
          </div>
        </section>
        <section class="auth-code-section auth-code-section-email">
          <header class="auth-section-header">
            <div><span class="auth-section-kicker">Buzón</span><h4>Códigos por correo</h4></div>
            <span class="auth-section-count">${emailCodes.length}</span>
          </header>
          <div class="auth-section-grid">
            ${emailCodes.length ? emailCodes.map(card => renderCode(card, "email")).join("") : empty("El Owner todavía no agregó correos IMAP con nombre.")}
          </div>
        </section>`;

      elements.authList.querySelectorAll(".copy-code-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
          const item = data.codes.find(card => String(card.id) === String(btn.dataset.cardId || ""));
          if (!item?.code || item.code === "------") return;
          await navigator.clipboard.writeText(String(item.code));
          setFeedback("Código copiado.", "success");
        });
      });
    } catch (err) {
      elements.authList.innerHTML = '<p class="muted" style="color:coral; text-align:center;">Error al cargar 2FA.</p>';
    }
  }

  function startAuthTimers() {
    stopAuthTimers();
    fetchAndRenderAuth();

    // Timer para bajar localmente el progreso segundo a segundo
    authLocalTimer = setInterval(() => {
      if (currentAuthRemaining > 0) {
        currentAuthRemaining--;
        const progressPct = (currentAuthRemaining / 30) * 100;
        const color = currentAuthRemaining <= 5 ? "var(--accent-red, #ff4d4d)" : "var(--accent-cyan)";

        document.querySelectorAll('.auth-item-time').forEach(el => el.textContent = currentAuthRemaining + "s");
        document.querySelectorAll('.auth-progress-bar').forEach(el => {
          el.style.width = progressPct + "%";
          el.style.background = color;
        });
        document.querySelectorAll('.auth-item-code').forEach(el => {
          el.style.color = color;
        });
      } else {
        // Llegó a cero, volvemos a obtener desde el servidor
        fetchAndRenderAuth();
      }
    }, 1000);
  }

  function stopAuthTimers() {
    if (authLocalTimer) clearInterval(authLocalTimer);
    if (authInterval) clearInterval(authInterval);
  }

  elements.openAuthButton.addEventListener("click", () => {
    if (state.role !== "owner" && state.role !== "admin") return;
    window.activateClientView("authDialog");
    startAuthTimers();
  });

  elements.closeAuthButton.addEventListener("click", () => {
    window.activateClientView("defaultView");
    stopAuthTimers();
  });

  elements.openStreamingButton?.addEventListener("click", () => {
    window.activateClientView("streamingDialog");
    const streamingCards = state.cards.filter(c => String(c.category_slug) === "streaming");
    prepareWorkspaceDialog(elements.streamingDialog, `${streamingCards.length} disponibles`);
    elements.streamingList.innerHTML = "";
    if (streamingCards.length === 0) {
      elements.streamingList.innerHTML = '<p class="muted" style="text-align:center; width:100%; grid-column:1/-1;">No hay plataformas de streaming disponibles.</p>';
    } else {
      streamingCards.forEach((c, index) => {
        const cardElement = createCardElement(c);
        prepareCardMotion(cardElement, index);
        elements.streamingList.appendChild(cardElement);
      });
      activateScrollMotion(elements.streamingList);
    }
  });

  elements.closeStreamingButton?.addEventListener("click", () => {
    window.activateClientView("defaultView");
  });

  elements.openMetodosButton.addEventListener("click", () => {
    window.activateClientView("metodosDialog");
    const metodosCards = state.cards.filter(c => String(c.category_slug) === "metodos");
    prepareWorkspaceDialog(elements.metodosDialog, `${metodosCards.length} disponibles`);
    elements.metodosList.innerHTML = "";
    if (metodosCards.length === 0) {
      elements.metodosList.innerHTML = '<p class="muted" style="text-align:center; width:100%; grid-column:1/-1;">No hay métodos disponibles.</p>';
    } else {
      metodosCards.forEach((c, index) => {
        const cardElement = createCardElement(c);
        prepareCardMotion(cardElement, index);
        elements.metodosList.appendChild(cardElement);
      });
      activateScrollMotion(elements.metodosList);
    }
  });

  elements.closeMetodosButton.addEventListener("click", () => {
    window.activateClientView("defaultView");
  });

  elements.closeVideoPlayerButton?.addEventListener("click", () => {
    elements.videoPlayerDialog?.close();
    if(elements.videoPlayerIframe) elements.videoPlayerIframe.src = ""; // Detiene el video
  });

  elements.openBotButton?.addEventListener("click", async () => {
    if (state.isCatalogOnly || state.userPlan === "none") {
      await requestSubscriptionForModule("Bot WhatsApp IAmax", "standard");
      return;
    }
    try {
      await openBotFullscreen();
    } catch (error) {
      if (error.code === "TOKEN_REQUIRED") {
        const loginOverlay = document.getElementById("loginOverlay");
        if (loginOverlay) loginOverlay.style.display = "flex";
      }
      setFeedback(error.message || "No se pudo abrir el Bot WhatsApp.", "error");
    }
  });

  elements.openBotWindowButton?.addEventListener("click", async () => {
    if (state.isCatalogOnly || state.userPlan === "none") {
      await requestSubscriptionForModule("Bot WhatsApp IAmax", "standard");
      return;
    }
    const botUrl = await getBotLaunchUrl();

    if (!botUrl) {
      setFeedback("Inicia sesion en el panel para abrir tu Bot WhatsApp.", "error");
      const loginOverlay = document.getElementById("loginOverlay");
      if (loginOverlay) loginOverlay.style.display = "flex";
      return;
    }

    try {
      if (window.iamaxDesktop?.openBotWindow) {
        const result = await window.iamaxDesktop.openBotWindow(botUrl);
        if (result?.error) throw new Error(result.error);
      } else {
        window.open(botUrl, "_blank");
      }
    } catch (error) {
      setFeedback(`No se pudo abrir el Bot WhatsApp en ventana: ${error.message}`, "error");
    }
  });

  const openOwnerPanelBtn = document.getElementById("openOwnerPanelBtn");
  if (openOwnerPanelBtn) {
    openOwnerPanelBtn.addEventListener("click", async () => {
      if (!state.isOwner) {
        setFeedback("Acceso exclusivo del owner.", "error");
        return;
      }
      if (window.iamaxDesktop?.openOwnerPanel) {
        const result = await window.iamaxDesktop.openOwnerPanel();
        if (result && result.success === false) {
          setFeedback(result.error || "No se pudo abrir el panel owner.", "error");
        }
        return;
      }
      const apiBase = await getApiBase();
      const token = await getOwnerToken();
      const role = localStorage.getItem("iamax_session_role") || "owner";
      const stored = await getSessionValues(["iamax_must_setup_2fa"]);
      const url = new URL(`${apiBase}/owner.html`);
      if (token) {
        url.searchParams.set("dt", token);
        url.searchParams.set("role", role);
        if (stored.iamax_must_setup_2fa === "1") {
          url.searchParams.set("m2fa", "1");
        }
      }
      window.open(url.toString(), "_blank");
    });
    refreshOwnerPanelButton();
  }

  elements.closeBotButton?.addEventListener("click", () => {
    window.activateClientView("defaultView");
  });

  const mobileMenuBtn = document.getElementById("mobileMenuBtn");
  const mobileSidebarOverlay = document.getElementById("mobileSidebarOverlay");
  const sidebar = document.querySelector(".sidebar");

  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener("click", () => {
      sidebar.classList.add("open");
      mobileSidebarOverlay.classList.add("open");
    });
  }

  if (mobileSidebarOverlay) {
    mobileSidebarOverlay.addEventListener("click", () => {
      sidebar.classList.remove("open");
      mobileSidebarOverlay.classList.remove("open");
    });
  }

    // Cerrar sidebar al clickear un link en celular
  document.querySelectorAll('.nav-category, .sidebar-footer button').forEach(btn => {
    btn.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        sidebar.classList.remove("open");
        mobileSidebarOverlay.classList.remove("open");
      }
    });
  });

  const reloadAppBtn = document.getElementById("reloadAppBtn");
  if (reloadAppBtn) {
    reloadAppBtn.addEventListener("click", () => {
      reloadAppBtn.style.transform = "rotate(180deg)";
      reloadAppBtn.style.transition = "transform 0.4s ease";
      setTimeout(() => {
        window.location.reload();
      }, 150);
    });
  }

  const togglePasswordBtn = document.getElementById("togglePasswordBtn");
  const unifiedPasswordInput = document.getElementById("unifiedPasswordInput");
  const eyeIcon = document.getElementById("eyeIcon");

  if (togglePasswordBtn && unifiedPasswordInput && eyeIcon) {
    togglePasswordBtn.addEventListener("click", () => {
      const type = unifiedPasswordInput.getAttribute("type") === "password" ? "text" : "password";
      unifiedPasswordInput.setAttribute("type", type);
      if (type === "text") {
        eyeIcon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>';
      } else {
        eyeIcon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
      }
    });
  }
}

async function bootstrap() {
  mountHeaderUtilities();
  setupNotificationCenter();
  setupLiveCounters();
  try {
    const apiBase = await getApiBase();
    const versionRes = await fetch(`${apiBase}/api/public/version`);
    if (versionRes.ok) {
      const {
        minVersion,
        latestVersion,
        updateUrl,
        desktopLatestVersion,
        desktopDisplayVersion,
        desktopUpdateLabel,
        desktopUpdateUrl,
        releaseNotes
      } = await versionRes.json();
      const injectedVersion = "__IAMAX_VERSION__";
      const currentVersion = injectedVersion.startsWith("__IAMAX_") ? DESKTOP_APP_VERSION : injectedVersion;
      const isNativeDesktop = Boolean(window.iamaxUpdates?.check);
      const effectiveUpdateUrl = isNativeDesktop ? (desktopUpdateUrl || updateUrl) : updateUrl;

      // Kill Switch Obligatorio (servidor: solo 1.3.1+)
      const effectiveMin = minVersion || "1.3.3";
      if (compareVersions(currentVersion, effectiveMin) < 0) {
        const killOverlay = document.getElementById("killSwitchOverlay");
        const killLink = document.getElementById("killSwitchLink");
        if (killOverlay && killLink) {
          killOverlay.classList.remove("hidden");
          const msg = document.querySelector("#killSwitchOverlay .kill-message, #killSwitchMessage");
          if (msg) {
            msg.textContent =
              `IAmax ${effectiveMin} es obligatoria. Tu version ${currentVersion} ya no opera. Actualiza el instalador.`;
          }
          if (effectiveUpdateUrl) {
            killLink.href = effectiveUpdateUrl;
          } else {
            killLink.style.display = "none";
          }
        }
        return; // Detener la app
      }

      // Banner de actualización: si el servidor tiene desktop más nuevo, avisar siempre.
      // (Antes dependía demasiado de electron-updater y a veces no salía la campana.)
      const serverDesktopVersion = desktopLatestVersion || null;
      const compareTarget = serverDesktopVersion || latestVersion;
      const currentIsOlder = Boolean(compareTarget)
        && compareVersions(currentVersion, compareTarget) < 0;

      if (isNativeDesktop) {
        let updaterStatus = null;
        try {
          updaterStatus = await window.iamaxUpdates.check();
        } catch (err) {
          console.warn("iamaxUpdates.check falló:", err);
        }

        const nativeCurrentVersion = updaterStatus?.internalCurrentVersion || currentVersion;
        const nativeIsOlder = Boolean(serverDesktopVersion)
          && compareVersions(nativeCurrentVersion, serverDesktopVersion) < 0;
        const shouldNotify = nativeIsOlder || currentIsOlder;

        if (shouldNotify) {
          showUpdateNotification({
            latestVersion: desktopDisplayVersion || serverDesktopVersion || DESKTOP_APP_VERSION,
            updateLabel: desktopUpdateLabel
              || updaterStatus?.updateInfo?.releaseName
              || `Actualizacion ${desktopDisplayVersion || serverDesktopVersion || DESKTOP_APP_VERSION}`,
            updateUrl: effectiveUpdateUrl || desktopUpdateUrl,
            releaseNotes
          });
          if (updaterStatus) renderUpdaterState(updaterStatus);
        } else {
          hideUpdateNotification();
        }
      } else if (currentIsOlder) {
        showUpdateNotification({
          latestVersion: desktopDisplayVersion || compareTarget,
          updateLabel: desktopUpdateLabel || `Actualizacion ${desktopDisplayVersion || compareTarget}`,
          updateUrl: desktopUpdateUrl || effectiveUpdateUrl || updateUrl,
          releaseNotes
        });
      }
    }
  } catch (e) {
    console.error("Error validando la versión:", e);
  }

  const localData = await chrome.storage.local.get("favorites");
  state.favorites = Array.isArray(localData.favorites) ? localData.favorites : [];
  wireEvents();

  // Logic for unified login screen
  const loginOverlay = document.getElementById("loginOverlay");
  const unifiedLoginForm = document.getElementById("unifiedLoginForm");
  const unifiedEmailInput = document.getElementById("unifiedEmailInput");
  const unifiedPasswordInput = document.getElementById("unifiedPasswordInput");
  const unifiedLoginError = document.getElementById("unifiedLoginError");
  const unifiedRememberSessionInput = document.getElementById("unifiedRememberSessionInput");
  const unified2faContainer = document.getElementById("unified2faContainer");
  const unified2faInput = document.getElementById("unified2faInput");
  const cancelUnified2faBtn = document.getElementById("cancelUnified2faBtn");
  const STAFF_ROLES = new Set(["owner", "admin", "supervisor"]);

  // Solo se recuerda el correo. Contraseña y tokens nunca se persisten.
  let savedLoginEmail = "";
  let pendingMfaToken = null;

  if (unifiedRememberSessionInput) {
    // Preferencia independiente: recordar correo no significa recordar sesión.
    if (localStorage.getItem("iamax_remember_login_email") == null) {
      unifiedRememberSessionInput.checked = true;
    } else {
      unifiedRememberSessionInput.checked = localStorage.getItem("iamax_remember_login_email") === "1";
    }
  }
  highlightLoginProofRole(localStorage.getItem("iamax_session_role") === "owner" ? "owner" : "");

  const fillSavedCredentials = () => {
    if (!unifiedEmailInput) return;
    if (savedLoginEmail && !unifiedEmailInput.value) {
      unifiedEmailInput.value = savedLoginEmail;
    }
  };

  const showStaff2faOnly = (mfaToken) => {
    pendingMfaToken = mfaToken || pendingMfaToken;
    if (unified2faContainer) {
      unified2faContainer.classList.remove("hidden");
      unified2faContainer.style.display = "block";
      unified2faContainer.setAttribute("aria-hidden", "false");
    }
    // Credenciales ocultas (ya se usaron) — solo pide código 2FA
    if (unifiedEmailInput?.parentElement) unifiedEmailInput.parentElement.style.display = "none";
    const passField = unifiedPasswordInput?.closest(".field");
    if (passField) passField.style.display = "none";
    const loginBtn = document.getElementById("unifiedLoginBtn");
    if (loginBtn) {
      loginBtn.textContent = "Verificar Código";
      loginBtn.style.opacity = "1";
    }
    if (unified2faInput) {
      unified2faInput.value = "";
      unified2faInput.focus();
    }
  };

  const showFullLoginForm = () => {
    pendingMfaToken = null;
    if (unified2faContainer) {
      unified2faContainer.classList.add("hidden");
      unified2faContainer.style.display = "none";
      unified2faContainer.setAttribute("aria-hidden", "true");
    }
    if (unifiedEmailInput?.parentElement) unifiedEmailInput.parentElement.style.display = "";
    const passField = unifiedPasswordInput?.closest(".field");
    if (passField) passField.style.display = "";
    const loginBtn = document.getElementById("unifiedLoginBtn");
    if (loginBtn) loginBtn.textContent = "Ingresar";
  };

  cancelUnified2faBtn?.addEventListener("click", () => {
    showFullLoginForm();
    if (unified2faInput) unified2faInput.value = "";
    if (unifiedLoginError) unifiedLoginError.style.display = "none";
    fillSavedCredentials();
    unifiedEmailInput?.focus();
  });

  // Al poner el cursor: rellenar solamente el correo recordado.
  if (unifiedEmailInput) {
    unifiedEmailInput.addEventListener("focus", fillSavedCredentials);
    unifiedEmailInput.addEventListener("click", fillSavedCredentials);
  }
  const loadSavedCredentials = async () => {
    try {
      savedLoginEmail = (await getRememberedLoginEmail()) || "";
      // Migrar una sola vez el correo de builds antiguas, sin conservar secretos.
      if (!savedLoginEmail) {
        savedLoginEmail = (await getBotEmail()) || "";
        if (savedLoginEmail) await setRememberedLoginEmail(savedLoginEmail);
      }
      // Eliminar persistencia heredada que causaba auto-login.
      setRememberSessionEnabled(false);
      await chrome.storage.local.remove([
        "ownerToken",
        "refreshToken",
        "botEmail",
        "botPassword",
        "iamax_remember_session"
      ]).catch(() => {});
      await chrome.storage.session.remove(["botEmail", "botPassword"]).catch(() => {});
      await setBotEmail("", false);
      await setBotPassword("", false);
      if (unifiedPasswordInput) {
        unifiedPasswordInput.value = "";
        unifiedPasswordInput.placeholder = "Tu contraseña";
      }
      if (savedLoginEmail && unifiedEmailInput && !unifiedEmailInput.value) {
        unifiedEmailInput.placeholder = savedLoginEmail;
        unifiedEmailInput.value = savedLoginEmail;
      }
    } catch (e) {
      /* ignore */
    }
  };

  const finishStaffOrClientLogin = async (loginData, loginRole, email, pass, rememberMe) => {
    // El checkbox ahora recuerda SOLO el correo. Los tokens viven en
    // chrome.storage.session y desaparecen al cerrar IAmax.
    setRememberSessionEnabled(false);
    if (rememberMe) {
      localStorage.setItem("iamax_remember_login_email", "1");
      await setRememberedLoginEmail(email);
      savedLoginEmail = email;
    } else {
      localStorage.removeItem("iamax_remember_login_email");
      await setRememberedLoginEmail("");
      savedLoginEmail = "";
    }

    persistSessionRole(loginRole);
    state.userEmail = String(email || "").trim().toLowerCase();
    highlightLoginProofRole(STAFF_ROLES.has(loginRole) ? "owner" : "client");

    await setSessionValues({ iamax_admin_role: loginRole });
    if (loginData.mustSetup2fa) {
      await setSessionValues({ iamax_must_setup_2fa: "1" });
    } else {
      await removeSessionValues(["iamax_must_setup_2fa"]);
    }

    await persistAuthTokens(loginData, false);
    await setBotEmail("", false);
    await setBotPassword("", false);
    await chrome.storage.local.remove([
      "ownerToken",
      "refreshToken",
      "botEmail",
      "botPassword",
      "iamax_remember_session"
    ]).catch(() => {});
    if (unifiedPasswordInput) unifiedPasswordInput.value = "";

    loginOverlay.classList.add("hidden");
    loginOverlay.style.display = "none";
    await loadDashboard();
  };

  const checkAuthAndLoad = async () => {
    await setGuestPassword("");
    await loadSavedCredentials();

    // Solo una sesión ya iniciada durante ESTA ejecución puede continuar.
    // Los tokens persistentes de builds antiguas ya se eliminaron arriba.
    let ownerToken = await getOwnerToken();
    if (!ownerToken) {
      try {
        ownerToken = await refreshAccessTokenIfPossible();
      } catch (e) { /* ignore */ }
    }

    if (ownerToken) {
      try {
        loginOverlay.classList.add("hidden");
        loginOverlay.style.display = "none";
        await loadDashboard();
        return;
      } catch (e) {
        console.warn("[Login] Token no válido, reautenticar:", e.message);
      }
    }

    // Sin sesión: formulario completo. Solo se prellena el correo.
    loginOverlay.classList.remove("hidden");
    loginOverlay.style.display = "flex";
    showFullLoginForm();
    fillSavedCredentials();
    if (savedLoginEmail && unifiedEmailInput) {
      unifiedEmailInput.value = savedLoginEmail;
    }
  };

  const inlineSignupForm = document.getElementById("inlineSignupForm");
  const registerAccountBtn = document.getElementById("registerAccountBtn");
  const backToLoginBtn = document.getElementById("backToLoginBtn");
  const inlineSignupFeedback = document.getElementById("inlineSignupFeedback");
  const showSignupForm = () => {
    unifiedLoginForm?.classList.add("hidden");
    inlineSignupForm?.classList.remove("hidden");
    inlineSignupFeedback?.classList.remove("is-success");
    if (inlineSignupFeedback) inlineSignupFeedback.style.display = "none";
    document.getElementById("signupBusinessInput")?.focus();
  };
  const showLoginAfterSignup = (email = "") => {
    inlineSignupForm?.classList.add("hidden");
    unifiedLoginForm?.classList.remove("hidden");
    if (email && unifiedEmailInput) unifiedEmailInput.value = email;
    if (unifiedPasswordInput) unifiedPasswordInput.value = "";
    unifiedPasswordInput?.focus();
  };
  registerAccountBtn?.addEventListener("click", showSignupForm);
  backToLoginBtn?.addEventListener("click", () => showLoginAfterSignup());
  inlineSignupForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const businessName = document.getElementById("signupBusinessInput")?.value.trim() || "";
    const email = document.getElementById("signupEmailInput")?.value.trim().toLowerCase() || "";
    const password = document.getElementById("signupPasswordInput")?.value || "";
    const confirmation = document.getElementById("signupPasswordConfirmInput")?.value || "";
    const submit = document.getElementById("inlineSignupBtn");
    if (password !== confirmation) {
      inlineSignupFeedback.textContent = "Las contraseñas no coinciden.";
      inlineSignupFeedback.classList.remove("is-success");
      inlineSignupFeedback.style.display = "block";
      return;
    }
    submit.disabled = true;
    submit.textContent = "Creando cuenta…";
    inlineSignupFeedback.style.display = "none";
    try {
      const result = await signupClient(email, password, businessName);
      inlineSignupFeedback.textContent = result.message || "Cuenta creada correctamente. Abriendo tu catálogo…";
      inlineSignupFeedback.classList.add("is-success");
      inlineSignupFeedback.style.display = "block";
      await setRememberedLoginEmail(email);
      let { deviceId } = await chrome.storage.local.get("deviceId");
      if (!deviceId) {
        deviceId = "dev_" + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        await chrome.storage.local.set({ deviceId });
      }
      const loginData = await loginAsClient(email, password, deviceId, false);
      await finishStaffOrClientLogin(loginData, "client", email, password, true);
    } catch (error) {
      inlineSignupFeedback.textContent = error.message || "No se pudo crear la cuenta.";
      inlineSignupFeedback.classList.remove("is-success");
      inlineSignupFeedback.style.display = "block";
    } finally {
      submit.disabled = false;
      submit.textContent = "Crear cuenta";
    }
  });

  if (unifiedLoginForm) {
    unifiedLoginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      unifiedLoginError.style.display = "none";
      fillSavedCredentials();
      const email = (unifiedEmailInput?.value || savedLoginEmail || "").trim();
      const pass = unifiedPasswordInput?.value || "";
      const rememberMe = Boolean(unifiedRememberSessionInput?.checked);
      const code2fa = unified2faInput?.value.trim() || "";

      try {
        const loginBtn = document.getElementById("unifiedLoginBtn");
        loginBtn.textContent = "Iniciando sesión...";
        loginBtn.style.opacity = "0.7";

        // Obtener o generar device ID
        let { deviceId } = await chrome.storage.local.get("deviceId");
        if (!deviceId) {
          deviceId = "dev_" + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
          await chrome.storage.local.set({ deviceId });
        }

        let loginData = null;
        let loginRole = "client";
        try {
          if (pendingMfaToken) {
            // Owner/admin: SIEMPRE verificar código 2FA
            const digits = String(code2fa || "").replace(/\D/g, "");
            if (!digits || digits.length !== 6) {
              throw new Error("Ingresa el código 2FA de 6 dígitos de la app Authenticator de IAmax.");
            }
            const { verify2faOwner } = await import("../shared/api.js");
            try {
              loginData = await verify2faOwner(pendingMfaToken, digits, false);
            } catch (mfaErr) {
              // Token MFA vencido → volver a email/pass
              const msg = String(mfaErr?.message || "");
              const code = mfaErr?.code || "";
              if (code === "MFA_TOKEN_EXPIRED" || /expiro|expir/i.test(msg)) {
                showFullLoginForm();
                throw new Error(msg || "Sesión 2FA expirada. Vuelve a poner email y contraseña.");
              }
              // Código malo: mantener pantalla 2FA para reintentar
              if (unified2faInput) {
                unified2faInput.value = "";
                unified2faInput.focus();
              }
              throw mfaErr;
            }
            loginRole = loginData.role || loginData.user?.role || "owner";
            pendingMfaToken = null;
          } else {
            // 1. Try to login as owner/admin
            loginData = await loginAsOwner(email, pass, false);

            if (loginData.requires2fa) {
              // Recordar solo el correo. La contraseña permanece únicamente
              // en el input durante este paso 2FA.
              if (rememberMe && email) {
                await setRememberedLoginEmail(email);
                savedLoginEmail = email;
                localStorage.setItem("iamax_remember_login_email", "1");
              }
              showStaff2faOnly(loginData.mfaToken);
              const loginBtn2 = document.getElementById("unifiedLoginBtn");
              if (loginBtn2) {
                loginBtn2.textContent = "Verificar Código";
                loginBtn2.style.opacity = "1";
              }
              return;
            }

            loginRole = loginData.role || loginData.user?.role || "owner";
          }
        } catch (ownerErr) {
          // Si estábamos en paso 2FA, no caer a cliente
          if (pendingMfaToken || document.getElementById("unified2faContainer")?.style.display === "block") {
            throw ownerErr;
          }
          try {
            // 2. Try to login as client if owner fails
            loginData = await loginAsClient(email, pass, deviceId, false);
            loginRole = "client";
          } catch (clientErr) {
            throw new Error(clientErr.message || ownerErr.message || "Credenciales incorrectas.");
          }
        }

        await finishStaffOrClientLogin(loginData, loginRole, email, pass, rememberMe);
      } catch (err) {
        unifiedLoginError.textContent = err.message || "Credenciales incorrectas.";
        unifiedLoginError.style.display = "block";
        // Si falló el 2FA, mantener pantalla de código
        if (pendingMfaToken) {
          const loginBtn = document.getElementById("unifiedLoginBtn");
          if (loginBtn) loginBtn.textContent = "Verificar Código";
        }
      } finally {
        const loginBtn = document.getElementById("unifiedLoginBtn");
        if (!pendingMfaToken) {
          loginBtn.textContent = "Ingresar";
        }
        loginBtn.style.opacity = "1";
      }
    });
  }

  await checkAuthAndLoad();
  // Sin banner de modo incógnito (obsoleto: aislamiento = Chromium por cardId).
}

bootstrap();

