import { getDashboardData, getAdminLoginUrl, trackLaunch, downloadSession, uploadSession, loginAsOwner, loginAsClient, get2FACodes, getTutorials, getLiveTracking, getReferralSummary, applyReferralCode, redeemReferralReward, getCardSecrets, reportBrokenCard, resolveBotAutoLoginUrl, refreshAccessTokenIfPossible, persistAuthTokens, logoutSession } from "../shared/api.js";
import { getApiBase, setApiBase, setGuestPassword, getOwnerToken, setOwnerToken, setBotEmail, setBotPassword, getBotEmail, getBotPassword, isRememberSessionEnabled, setRememberSessionEnabled, clearLocalAuthSession } from "../shared/config.js";
import { sanitizeHexColor, sanitizeCssUrl, sanitizeImageSrc, isSafeUpdateUrl } from "../shared/sanitize.js";
import { setSessionValues, getSessionValues, removeSessionValues } from "../shared/sessionStore.js";

const authCredentialCache = new Map();

const state = {
  settings: null,
  categories: [],
  cards: [],
  search: "",
  category: "all",
  isLocked: true,
  favorites: []
};
let liveUsersMap = {};
let liveCounterTimer = null;

function buildCardLaunchOptions(card, overrides = {}) {
  return {
    verificationCompatibility: Boolean(card.verification_compatibility),
    userAgent: card.user_agent,
    acceptLanguage: card.accept_language,
    webrtcMode: card.webrtc_mode,
    loginMethod: getCardLoginMethod(card),
    spoofEnabled: Boolean(card.spoof_enabled),
    ...overrides
  };
}

function buildProfileModules(card) {
  const modules = ["core", "session", "injector", "shield"];
  if (card?.clear_cache_button) modules.push("clear-cache");
  if (card?.streaming_drm_clean) modules.push("streaming-clean");
  try {
    const hostname = new URL(card?.url || "").hostname.toLowerCase();
    if (hostname === "chatgpt.com" || hostname.endsWith(".openai.com")) modules.push("chatgpt-diagnostics");
  } catch (error) {}
  return modules;
}

async function configureProfileModules(card) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: "SET_PROFILE_MODULES",
      cardId: card.id,
      modules: buildProfileModules(card)
    }, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response?.success) return reject(new Error(response?.error || "No se pudieron configurar los modulos"));
      resolve(response.modules);
    });
  });
}

/** Método de login real de la tarjeta (sin inventar google si no viene). */
function getCardLoginMethod(card) {
  const configured = String(card?.login_method || "").trim().toLowerCase();
  // Compatibilidad con tarjetas antiguas: antes de existir login_method, el
  // checkbox client_can_inject ya identificaba las tarjetas Google. No se
  // habilita nada nuevo: solo se respeta una asignacion explicita del Owner.
  if (!configured && card?.client_can_inject === true) return "google";
  return configured;
}

function isGoogleInjectMethod(card) {
  return getCardLoginMethod(card) === "google";
}

/** Owner siempre (si Google); clientes solo si client_can_inject. */
function canShowInjectButton(card) {
  if (!isGoogleInjectMethod(card)) return false;
  if (state.isOwner) return true;
  return Boolean(card?.client_can_inject);
}

function getExtensionIncognitoOpenAs(card) {
  const configured = String(card?.open_as || "popup").replace(/^incognito_/, "");
  const mode = configured === "tab" || configured === "full" ? configured : "popup";
  return `incognito_${mode}`;
}

async function requireIncognitoAccess() {
  const allowed = await new Promise((resolve) => {
    chrome.extension.isAllowedIncognitoAccess((value) => {
      if (chrome.runtime.lastError) return resolve(false);
      resolve(Boolean(value));
    });
  });
  if (allowed) return true;

  setFeedback(
    'Activa "Permitir en incognito" para IAmax. Es necesario para aislar tus cuentas personales y mostrar el boton de inyeccion.',
    "error"
  );
  await chrome.tabs.create({
    url: `chrome://extensions/?id=${encodeURIComponent(chrome.runtime.id)}`
  }).catch(() => {});
  return false;
}

async function savePendingInjectSession(card, extra = {}) {
  const method = getCardLoginMethod(card);
  await setSessionValues({
    clientCanInject: Boolean(card.client_can_inject),
    clientInjectMethod: method,
    isOwner: Boolean(state.isOwner),
    spoofEnabled: Boolean(card.spoof_enabled),
    ...extra
  });
  if (canShowInjectButton(card)) {
    await setSessionValues({ pendingInjectCardId: card.id });
  } else {
    await removeSessionValues(["pendingInjectCardId"]);
  }
}

function normalizeProxyProtocol(raw, hostHint = "") {
  const rawValue = String(raw || "").toLowerCase();
  const hostValue = String(hostHint || "").toLowerCase();
  const combined = `${rawValue} ${hostValue}`;
  if (/socks5|socks 5|s5\b|socks5h/.test(combined)) return "socks5";
  if (/socks4|socks 4|s4\b|socks4a/.test(combined)) return "socks4";
  if (/(^|[^a-z])socks([^a-z0-9]|$)/.test(combined) || hostValue.includes(".socks.")) {
    return "socks5";
  }
  if (rawValue.includes("https") || hostValue.startsWith("https")) return "https";
  return "http";
}

async function buildProxyData(card) {
  const proxyData = {
    host: String(card.proxy_host || "")
      .replace(/^(socks5h?|socks4a?|socks|http|https):\/\//i, "")
      .trim(),
    port: card.proxy_port || "",
    username: card.proxy_username || "",
    password: "",
    protocol: normalizeProxyProtocol(card.proxy_type || "HTTP", card.proxy_host || "")
  };

  if (!proxyData.host && !card.has_proxy_credentials) {
    return proxyData;
  }

  try {
    const ownerToken = await getOwnerToken();
    const secrets = await getCardSecrets(card.id, "", ownerToken);
    const merged = {
      ...proxyData,
      ...(secrets.proxy || {}),
      username: secrets.proxy?.username || secrets.proxy?.user || proxyData.username || "",
      password: secrets.proxy?.password || secrets.proxy?.pass || ""
    };
    merged.host = String(merged.host || "")
      .replace(/^(socks5h?|socks4a?|socks|http|https):\/\//i, "")
      .split("/")[0]
      .split("@")
      .pop()
      .trim();
    merged.protocol = normalizeProxyProtocol(
      merged.protocol || secrets.proxy?.protocol || secrets.proxy?.type || card.proxy_type || "HTTP",
      merged.host
    );
    return merged;
  } catch (error) {
    console.warn("[Dashboard] No se pudieron recuperar los secretos del proxy:", error);
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
  const canUseAuthenticator = role === "owner" || role === "admin";
  if (elements.openAuthButton) elements.openAuthButton.hidden = !canUseAuthenticator;

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
    const activeUsers = Number(liveUsersMap[cardId] || 0);
    badge.textContent = `${activeUsers} en uso`;
  });
}

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
  liveCounterTimer = setInterval(() => void fetchLiveUsers(), 5000);
}

function refreshOwnerPanelButton() {
  const openOwnerPanelBtn = document.getElementById("openOwnerPanelBtn");
  const openConfigButton = document.getElementById("openConfigButton");
  const referralCenterButton = document.getElementById("referralCenterButton");
  const canManage = Boolean(state.isStaff);
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
  closeBotButton: document.querySelector("#closeBotButton")
};

const extensionLoadingScreen = document.getElementById("extensionLoadingScreen");
const extensionLoadingText = document.getElementById("extensionLoadingText");

function showExtensionLoader(message = "Cargando perfiles y sesiones...") {
  if (extensionLoadingText) extensionLoadingText.textContent = message;
  extensionLoadingScreen?.classList.remove("is-leaving");
}

function hideExtensionLoader() {
  extensionLoadingScreen?.classList.add("is-leaving");
}

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

function showUpdateNotification({ latestVersion, updateUrl, releaseNotes }) {
  const center = document.getElementById("notificationCenter");
  const panel = document.getElementById("notificationPanel");
  const badge = document.getElementById("notificationBadge");
  const title = document.getElementById("notificationTitle");
  const list = document.getElementById("notificationList");
  const action = document.getElementById("notificationUpdateAction");
  if (!center || !panel || !badge || !title || !list || !action) return;

  const notes = Array.isArray(releaseNotes) && releaseNotes.length
    ? releaseNotes
    : [
      "Actualizacion 1.3.0: inyeccion Google/Gemini y ventana flotante.",
      "Bot WhatsApp y perfiles FLOW mas estables.",
      "Aviso DEBES ACTUALIZAR en rojo para versiones antiguas.",
      "Actualiza a 1.3.0 para seguir usando IAmax."
    ];

  title.textContent = `Cambios v${latestVersion || "nueva"}`;
  list.innerHTML = notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
  document.getElementById("notificationEmpty")?.classList.add("hidden");
  document.getElementById("notificationLabel")?.classList.remove("hidden");
  document.getElementById("notificationUpdateCard")?.classList.remove("hidden");
  action.textContent = "Descargar";
  action.onclick = () => {
    if (!isSafeUpdateUrl(updateUrl)) return;
    if (globalThis.chrome?.tabs?.create) {
      globalThis.chrome.tabs.create({ url: updateUrl });
      return;
    }
    window.open(updateUrl, "_blank", "noopener");
  };
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
  const applyForm = document.getElementById("referralClientApplyForm");
  if (codeElement) codeElement.textContent = code;
  if (creditsElement) creditsElement.textContent = String(credits);
  applyForm?.classList.toggle("hidden", payload.client.referral_eligible !== true || Boolean(payload.referrer));

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
  } else if (!payload.client.referral_eligible) {
    setReferralClientMessage("Solo las cuentas nuevas pueden aplicar un codigo de invitacion.");
  } else {
    setReferralClientMessage("Puedes aplicar un codigo una sola vez.");
  }
}

async function loadClientReferrals() {
  if (state.isStaff || state.isLocked) return;
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
    if (state.isStaff || state.isLocked) return;
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

function setFeedback(message = "", type = "info") {
  if (!message) {
    elements.feedbackBox.classList.add("hidden");
    elements.feedbackBox.textContent = "";
    elements.feedbackBox.removeAttribute("data-type");
    return;
  }

  elements.feedbackBox.classList.remove("hidden");
  elements.feedbackBox.dataset.type = type;
  elements.feedbackBox.textContent = message;
}

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
  authCredentialCache.clear();
  await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "REVOKE_ACCESS_STATE", reason: "ACCESS_REVOKED" }, () => resolve());
  });
  await clearLocalAuthSession();
  await setOwnerToken("");
  state.isLocked = true;
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
  const loginError = document.getElementById("unifiedLoginError");
  if (loginOverlay) loginOverlay.style.display = "flex";
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
  const msg = String(error?.message || "").toLowerCase();
  if (
    error?.status === 401 ||
    error?.status === 403 ||
    ["AUTH_REQUIRED", "TOKEN_EXPIRED", "TOKEN_INVALID", "TOKEN_REVOKED", "DEVICE_REVOKED", "SUBSCRIPTION_EXPIRED", "ACCOUNT_INACTIVE", "ACCESS_REVOKED"].includes(error?.code) ||
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
    elements.cardGrid.innerHTML = `
      <section class="empty-state-panel">
        <div class="empty-state-glow"></div>
        <p class="eyebrow">Acceso protegido</p>
        <h2>Dashboard bloqueado</h2>
        <p class="muted">Inicia sesión para cargar las herramientas asignadas a tu cuenta.</p>
      </section>
    `;
    return;
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
    if (liveBadge) {
      liveBadge.dataset.cardId = String(card.id);
      const activeUsers = Number(liveUsersMap[card.id] ?? card.activeUsers ?? 0);
      liveBadge.textContent = `${activeUsers} en uso`;
    }
    const actions = template.querySelector(".iamax-actions");
    const optionsBtn = template.querySelector(".options-btn");
    optionsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
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
    // Abrir aislado de las cuentas y cookies del Chrome personal.

    if (card.requires_session === false) {
      reportBtn.style.display = "none";
    }

    if (showClearCacheButton) {
      clearLocalBtn.classList.remove("hidden");
      clearLocalBtn.style.display = "";
      clearLocalBtn.textContent = "Limpiar perfil";
    } else {
      clearLocalBtn.style.display = "none";
    }

    // Inyectar solo si el método de login de la tarjeta es Google
    if (!canShowInjectButton(card)) {
      injectBtn.style.display = "none";
    }

    // ── (sin toggle local — el spoof se controla desde el servidor por tarjeta) ──

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
          const accessHandled = await handleAccessError({
            status: response?.code === "AUTH_REQUIRED" ? 401 : undefined,
            code: response?.code,
            message: response?.error || response?.message || ""
          });
          if (!accessHandled) {
            setFeedback(
              response?.error || response?.message || "Asegúrate de tener la ventana de Google abierta antes de inyectar.",
              "error"
            );
          }
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
      if (!window.iamaxDesktop && card.assigned_extensions && card.assigned_extensions.length > 0) {
        setFeedback("Esta herramienta requiere componentes nativos. Por favor, ábrela desde la aplicación IAmax Desktop (.exe o .dmg).", "error");
        return;
      }
      setFeedback("Abriendo perfil...", "info");
      if (!await requireIncognitoAccess()) return;
      showExtensionLoader("Abriendo perfil...");
      try {
        await configureProfileModules(card);
      // Guardar el ID para auto-inyección en Google Shield (solo método Google)
      await savePendingInjectSession(card, {
        pendingClearCacheBtn: Boolean(card.clear_cache_button),
        verificationCompatibility: Boolean(card.verification_compatibility)
      });

      if (card.blocked_selectors) {
        try {
          const urlObj = new URL(card.url);
          await new Promise((resolve) => {
            chrome.runtime.sendMessage({
              type: "SET_BLOCKED_SELECTORS",
              domain: urlObj.hostname,
              selectors: card.blocked_selectors
            }, resolve);
          });
        } catch(e) {}
      }

      // Abrir siempre aislado de las cuentas y cookies del Chrome personal.
      const finalOpenAs = getExtensionIncognitoOpenAs(card);

      if (card.requires_session === false) {
        setFeedback("Limpiando perfil y abriendo enlace...", "info");
        const proxyData = await buildProxyData(card);
        await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            type: "CLEAR_AND_OPEN",
            cardId: card.id,
            url: card.url,
            openAs: finalOpenAs,
            enableIncognitoRestart: false,
            enableClearCacheBtn: Boolean(card.clear_cache_button),
            proxyData,
            ...buildCardLaunchOptions(card)
          }, resolve);
        });
      } else {
        setFeedback("Abriendo perfil...", "info");
        try {
          const guestPass = "";
          const ownerToken = await getOwnerToken();
          const sessionData = await downloadSession(card.id, guestPass, ownerToken);
          const proxyData = await buildProxyData(card);
          
          await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
              type: "INJECT_SESSION",
              cardId: card.id,
              url: card.url,
              sessionData,
              openAs: finalOpenAs,
              enableIncognitoRestart: false,
              enableClearCacheBtn: Boolean(card.clear_cache_button),
              proxyData,
              ...buildCardLaunchOptions(card)
            }, response => {
              if (chrome.runtime.lastError) {
                return reject(new Error("Fallo de comunicación con la extensión: " + chrome.runtime.lastError.message));
              }
              if (response && response.error) reject(new Error(response.error));
              else resolve();
            });
          });
          
          setFeedback("Sesión inyectada. Abriendo herramienta...", "success");
        } catch (error) {
          console.warn("No se pudo inyectar sesión (quizás no hay guardada):", error);
          if (await handleAccessError(error)) return;
          
          if (error.message && error.message.includes("ERR_FAILED")) {
            console.error("Error de red o proxy al abrir herramienta:", error);
            setFeedback("Fallo de red o proxy.", "error");
            return;
          }
          
          // Si falla la inyección porque no hay sesión, limpiamos para que inicien sesión de cero
          setFeedback("Abriendo entorno limpio (no hay sesión)...", "info");
          
          // Si no existe sesion de servidor, abre Google limpio. Conservar la
          // sesion incognito compartida filtraba cuentas de otra herramienta.
          let cleanUrl = card.url;
          let isGoogleTool = cleanUrl.toLowerCase().includes('google.com') || cleanUrl.toLowerCase().includes('aitestkitchen.withgoogle.com') || cleanUrl.toLowerCase().includes('aistudio.google.com');

          if (isGoogleTool) {
            setFeedback("Abriendo entorno Google limpio (no hay sesión)...", "info");
          } else {
            setFeedback("Abriendo entorno limpio (no hay sesión)...", "info");
          }
          
          const proxyData = await buildProxyData(card);
          await new Promise((resolve) => {
            chrome.runtime.sendMessage({
              type: "CLEAR_AND_OPEN",
              cardId: card.id,
              url: cleanUrl,
              openAs: finalOpenAs,
              enableIncognitoRestart: false,
              dontClearCookies: false,
              enableClearCacheBtn: Boolean(card.clear_cache_button),
              proxyData,
              ...buildCardLaunchOptions(card)
            }, resolve);
          });
        }
      }

      trackLaunchWithAuth(card.id).catch(() => {});
      setFeedback("Perfil abierto.", "success");
      } finally {
        hideExtensionLoader();
      }
    });

    const uploadBtn = template.querySelector(".upload-session-btn");
    
    clearLocalBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!state.isOwner) return;
      if (!confirm(`¿Limpiar por completo el perfil de ${card.name}? Se borraran cookies y sesiones locales para iniciar con otra cuenta.`)) return;
      setFeedback("Limpiando completamente el perfil...", "warning");
      if (!await requireIncognitoAccess()) return;
      await configureProfileModules(card);
      
      // Guardar el ID para auto-inyección
      await removeSessionValues(["pendingInjectCardId"]);
      const proxyData = await buildProxyData(card);
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          cardId: card.id,
          type: "CLEAR_AND_OPEN",
          url: card.url,
          openAs: getExtensionIncognitoOpenAs(card),
          enableIncognitoRestart: false,
          dontClearCookies: false,
          enableClearCacheBtn: Boolean(card.clear_cache_button),
          skipAutoInject: true,
          proxyData,
          ...buildCardLaunchOptions(card)
        }, resolve);
      });
      setFeedback("Perfil limpio. Ya puedes iniciar con otra cuenta.", "success");
    });

    getOwnerToken().then(token => {
      if (state.isStaff && token) {
        uploadBtn.classList.remove("hidden");
        
        uploadBtn.addEventListener("click", async (e) => {
          e.stopPropagation(); // Evitar que se abra la tarjeta
          setFeedback("Extrayendo sesión del navegador...", "info");
          try {
            const sessionData = await new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({
                type: "EXTRACT_SESSION",
                url: card.url,
                extractFromIncognito: true
              }, response => {
                if (chrome.runtime.lastError) return reject(new Error("Fallo de comunicación: " + chrome.runtime.lastError.message));
                if (response && response.error) reject(new Error(response.error));
                else resolve(response);
              });
            });
            
            setFeedback("Subiendo sesión al servidor...", "info");
            await uploadSession(card.id, sessionData, token);
            setFeedback("¡Sesión guardada con éxito!", "info");
          } catch (error) {
            if (await handleAccessError(error)) return;
            setFeedback("Error al guardar sesión: " + error.message, "error");
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
  if (chrome?.tabs?.create) {
    await chrome.tabs.create({ url: botUrl, active: true });
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
    if (!payload.isStaff && !payload.isOwner && isPastDate(payload.expiresAt)) {
      await forceLogin(SUBSCRIPTION_EXPIRED_MESSAGE);
      return;
    }
    state.settings = payload.settings || {};
    state.categories = Array.isArray(payload.categories) ? payload.categories : [];
    state.cards = Array.isArray(payload.cards) ? payload.cards : [];
    state.isLocked = payload.isLocked || false;
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
    
    if (state.isLocked) {
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
    if (!state.isStaff) return;
    await hydrateConfigForm();
    window.activateClientView("configDialog");
  });

  const logoutBtn = document.getElementById("logoutButton");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        logoutBtn.disabled = true;
        await logoutSession();
        authCredentialCache.clear();
        await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: "REVOKE_ACCESS_STATE", reason: "LOGOUT" }, () => resolve());
        });
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
      
      authCredentialCache.clear();
      elements.authList.innerHTML = data.codes.map(card => {
        const progressPct = (currentAuthRemaining / 30) * 100;
        const color = currentAuthRemaining <= 5 ? "var(--accent-red, #ff4d4d)" : "var(--accent-cyan)";
        if (card.login_email && card.login_password) {
          authCredentialCache.set(String(card.id), {
            cardId: card.id,
            email: card.login_email,
            password: card.login_password,
            totp: card.code !== "------" ? String(card.code || "").replace(/\s+/g, "") : ""
          });
        }
        
        return `
          <div class="auth-item">
            <div class="auth-item-header">
              <span>${escapeHtml(card.name)}</span>
            </div>
            <div class="auth-item-code" style="color: ${color}">
              <span>${card.code === '------' ? (card.login_email ? 'Credenciales listas' : 'Sin codigo') : '******'}</span>
              ${card.code !== '------' ? `<span class="auth-item-time" id="time-${card.id}">${currentAuthRemaining}s</span>` : ''}
            </div>
            ${(card.login_email && card.login_password) ? `<button class="iamax-btn ghost autofill-btn" data-card-id="${card.id}" type="button">Inyectar credenciales y 2FA</button>` : ''}
            ${card.code !== '------' ? `
            <div class="auth-progress-bg">
              <div class="auth-progress-bar" id="prog-${card.id}" style="width: ${progressPct}%; background: ${color};"></div>
            </div>` : ''}
          </div>
        `;
      }).join('');
      
      elements.authList.querySelectorAll(".autofill-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const cached = authCredentialCache.get(String(btn.dataset.cardId || ""));
          if (!cached) {
            setFeedback("Credenciales no disponibles.", "error");
            return;
          }
          chrome.runtime.sendMessage({
            type: "INJECT_CREDENTIALS",
            cardId: cached.cardId,
            email: cached.email,
            password: cached.password,
            totpCode: cached.totp
          }, (response) => {
            if (response && response.success) {
              setFeedback(response.message || "Inyectado correctamente.", "success");
            } else {
              setFeedback("Error: " + (response?.error || response?.message || "No se pudo inyectar"), "error");
            }
          });
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

  elements.openStreamingButton.addEventListener("click", () => {
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

  elements.closeStreamingButton.addEventListener("click", () => {
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
    try {
      const botUrl = await resolveBotAutoLoginUrl("/client/live-chat");
      const botIframe = document.getElementById("botIframe");
      if (botIframe) {
        botIframe.src = botUrl;
      }
      window.activateClientView("botDialog");
    } catch (error) {
      if (error.code === "TOKEN_REQUIRED") {
        const loginOverlay = document.getElementById("loginOverlay");
        if (loginOverlay) loginOverlay.style.display = "flex";
      }
      setFeedback(error.message || "No se pudo abrir el Bot WhatsApp.", "error");
    }
  });

  const openOwnerPanelBtn = document.getElementById("openOwnerPanelBtn");
  if (openOwnerPanelBtn) {
    openOwnerPanelBtn.addEventListener("click", async () => {
      if (!state.isStaff) {
        setFeedback("Acceso exclusivo del equipo administrativo.", "error");
        return;
      }
      const apiBase = await getApiBase();
      window.open(`${apiBase}/owner.html`, "_blank");
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
      const { minVersion, extensionLatestVersion, updateUrl, releaseNotes } = await versionRes.json();
      const injectedVersion = "__IAMAX_VERSION__";
      const currentVersion = injectedVersion.startsWith("__IAMAX_") ? chrome.runtime.getManifest().version : injectedVersion;

      // Kill Switch Obligatorio (servidor: solo Extension 1.3.1+)
      const effectiveMin = minVersion || "1.3.3";
      if (compareVersions(currentVersion, effectiveMin) < 0) {
        const killOverlay = document.getElementById("killSwitchOverlay");
        const killLink = document.getElementById("killSwitchLink");
        if (killOverlay && killLink) {
          killOverlay.classList.remove("hidden");
          const msg = document.querySelector("#killSwitchOverlay .kill-message, #killSwitchMessage");
          if (msg) {
            msg.textContent =
              `Extension IAmax ${effectiveMin} es obligatoria. Tu v${currentVersion} ya no opera. Reinstala 1.3.1.`;
          }
          if (isSafeUpdateUrl(updateUrl)) {
            killLink.href = updateUrl;
          } else {
            killLink.style.display = "none";
          }
        }
        hideExtensionLoader();
        return; // Detener la app
      }

      // Banner de actualización opcional
      if (extensionLatestVersion && compareVersions(currentVersion, extensionLatestVersion) < 0) {
        showUpdateNotification({ latestVersion: extensionLatestVersion, updateUrl, releaseNotes });
      } else {
        hideUpdateNotification();
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
  const STAFF_ROLES = new Set(["owner", "admin", "supervisor"]);
  let savedLoginEmail = "";
  let savedLoginPassword = "";
  let pendingMfaToken = null;

  if (unifiedRememberSessionInput) {
    if (localStorage.getItem("iamax_remember_session") == null) {
      unifiedRememberSessionInput.checked = true;
    } else {
      unifiedRememberSessionInput.checked = isRememberSessionEnabled();
    }
  }
  highlightLoginProofRole(localStorage.getItem("iamax_session_role") === "owner" ? "owner" : "");

  const fillSavedCredentials = () => {
    if (!unifiedEmailInput || !unifiedPasswordInput) return;
    if (savedLoginEmail && !unifiedEmailInput.value) unifiedEmailInput.value = savedLoginEmail;
    if (savedLoginPassword && !unifiedPasswordInput.value) unifiedPasswordInput.value = savedLoginPassword;
  };

  const showStaff2faOnly = (mfaToken) => {
    pendingMfaToken = mfaToken || pendingMfaToken;
    if (unified2faContainer) unified2faContainer.style.display = "block";
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
    if (unified2faContainer) unified2faContainer.style.display = "none";
    if (unifiedEmailInput?.parentElement) unifiedEmailInput.parentElement.style.display = "";
    const passField = unifiedPasswordInput?.closest(".field");
    if (passField) passField.style.display = "";
    const loginBtn = document.getElementById("unifiedLoginBtn");
    if (loginBtn) loginBtn.textContent = "Ingresar al Panel";
  };

  if (unifiedEmailInput) {
    unifiedEmailInput.addEventListener("focus", fillSavedCredentials);
    unifiedEmailInput.addEventListener("click", fillSavedCredentials);
  }
  if (unifiedPasswordInput) {
    unifiedPasswordInput.addEventListener("focus", fillSavedCredentials);
    unifiedPasswordInput.addEventListener("click", fillSavedCredentials);
  }

  const loadSavedCredentials = async () => {
    try {
      savedLoginEmail = (await getBotEmail()) || "";
      savedLoginPassword = (await getBotPassword()) || "";
      if (savedLoginEmail && unifiedEmailInput && !unifiedEmailInput.value) {
        unifiedEmailInput.placeholder = savedLoginEmail;
        unifiedEmailInput.value = savedLoginEmail;
      }
      if (savedLoginPassword && unifiedPasswordInput) {
        unifiedPasswordInput.placeholder = "Contraseña guardada — clic para rellenar";
      }
    } catch (e) { /* ignore */ }
  };

  const finishStaffOrClientLogin = async (loginData, loginRole, email, pass, rememberMe) => {
    setRememberSessionEnabled(rememberMe);
    if (rememberMe) localStorage.setItem("iamax_remember_session", "1");
    else localStorage.removeItem("iamax_remember_session");

    persistSessionRole(loginRole);
    highlightLoginProofRole(STAFF_ROLES.has(loginRole) ? "owner" : "client");
    await persistAuthTokens(loginData, rememberMe);
    if (rememberMe && email) {
      await setBotEmail(email, true);
      await setBotPassword(pass || "", true);
      savedLoginEmail = email;
      savedLoginPassword = pass || "";
    } else {
      // Sin "Recordar sesion": no dejar credenciales viejas que rearmen auto-login
      await setBotEmail("", false);
      await setBotPassword("", false);
      savedLoginEmail = "";
      savedLoginPassword = "";
      try {
        await chrome.storage.local.remove(["botEmail", "botPassword", "iamax_remember_session"]);
        await chrome.storage.session.remove(["botEmail", "botPassword", "iamax_remember_session"]);
      } catch { /* ignore */ }
    }

    loginOverlay.style.display = "none";
    await loadDashboard();

    if (state.isLocked) {
      await setOwnerToken("");
      loginOverlay.style.display = "flex";
      if (unifiedLoginError) {
        unifiedLoginError.textContent = "Tu sesión no tiene permisos o ha expirado.";
        unifiedLoginError.style.display = "block";
        unifiedLoginError.style.background = "rgba(248, 113, 113, 0.12)";
        unifiedLoginError.style.borderColor = "rgba(248, 113, 113, 0.45)";
        unifiedLoginError.style.color = "#fecaca";
      }
    }
  };

  const tryStaffLoginWithSavedCreds = async () => {
    const remember = isRememberSessionEnabled() || Boolean(unifiedRememberSessionInput?.checked);
    if (!remember) return false;
    const email = savedLoginEmail || (await getBotEmail()) || "";
    const pass = savedLoginPassword || (await getBotPassword()) || "";
    if (!email || !pass) return false;
    try {
      const loginData = await loginAsOwner(email, pass, true);
      if (loginData.requires2fa) {
        showStaff2faOnly(loginData.mfaToken);
        return true;
      }
      const loginRole = loginData.role || loginData.user?.role || "owner";
      if (STAFF_ROLES.has(loginRole)) {
        await finishStaffOrClientLogin(loginData, loginRole, email, pass, true);
        return true;
      }
    } catch (e) {
      console.warn("[Login] Auto staff falló:", e.message);
    }
    return false;
  };

  const checkAuthAndLoad = async () => {
    await setGuestPassword("");
    await loadSavedCredentials();

    const roleHint = String(
      localStorage.getItem("iamax_session_role")
      || (await getSessionValues(["iamax_admin_role"])).iamax_admin_role
      || ""
    ).toLowerCase();
    const isStaffUser = STAFF_ROLES.has(roleHint);

    // Owner/admin: siempre pedir 2FA; credenciales se rellenan solas
    if (isStaffUser && (savedLoginEmail && savedLoginPassword || isRememberSessionEnabled())) {
      loginOverlay.style.display = "flex";
      showFullLoginForm();
      fillSavedCredentials();
      const wentTo2fa = await tryStaffLoginWithSavedCreds();
      if (wentTo2fa) return;
      if (savedLoginEmail && unifiedEmailInput) unifiedEmailInput.value = savedLoginEmail;
      return;
    }

    let ownerToken = await getOwnerToken();
    if (!ownerToken) {
      try { ownerToken = await refreshAccessTokenIfPossible(); } catch (e) { /* ignore */ }
    }

    if (ownerToken) {
      loginOverlay.style.display = "none";
      await loadDashboard();
      if (state.isLocked) {
        await setOwnerToken("");
        loginOverlay.style.display = "flex";
        if (unifiedLoginError) {
          unifiedLoginError.textContent = "Tu sesion expiro o no es valida. Inicia sesion nuevamente.";
          unifiedLoginError.style.display = "block";
          unifiedLoginError.style.background = "rgba(248, 113, 113, 0.12)";
          unifiedLoginError.style.borderColor = "rgba(248, 113, 113, 0.45)";
          unifiedLoginError.style.color = "#fecaca";
        }
      }
      return;
    }

    loginOverlay.style.display = "flex";
    showFullLoginForm();
    fillSavedCredentials();
    const wentTo2fa = await tryStaffLoginWithSavedCreds();
    if (!wentTo2fa && savedLoginEmail && unifiedEmailInput) {
      unifiedEmailInput.value = savedLoginEmail;
    }
  };

  if (unifiedLoginForm) {
    unifiedLoginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      unifiedLoginError.style.display = "none";
      fillSavedCredentials();
      const email = (unifiedEmailInput?.value || savedLoginEmail || "").trim();
      const pass = unifiedPasswordInput?.value || savedLoginPassword || "";
      const rememberMe = Boolean(unifiedRememberSessionInput?.checked);
      const code2fa = unified2faInput?.value.trim() || "";

      showExtensionLoader("Abriendo tus perfiles...");

      try {
        const loginBtn = document.getElementById("unifiedLoginBtn");
        loginBtn.textContent = "Iniciando sesión...";
        loginBtn.style.opacity = "0.7";

        let { deviceId } = await chrome.storage.local.get("deviceId");
        if (!deviceId) {
          deviceId = "dev_" + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
          await chrome.storage.local.set({ deviceId });
        }

        let loginData = null;
        let loginRole = "client";
        try {
          if (pendingMfaToken) {
            if (!code2fa) throw new Error("Ingresa el código 2FA.");
            const { verify2faOwner } = await import("../shared/api.js");
            loginData = await verify2faOwner(pendingMfaToken, code2fa, rememberMe);
            loginRole = loginData.role || loginData.user?.role || "owner";
            pendingMfaToken = null;
          } else {
            loginData = await loginAsOwner(email, pass, rememberMe);
            if (loginData.requires2fa) {
              if (rememberMe && email) {
                await setBotEmail(email, true);
                await setBotPassword(pass, true);
                savedLoginEmail = email;
                savedLoginPassword = pass;
                setRememberSessionEnabled(true);
              }
              hideExtensionLoader();
              showStaff2faOnly(loginData.mfaToken);
              return;
            }
            loginRole = loginData.role || loginData.user?.role || "owner";
          }
        } catch (ownerErr) {
          if (pendingMfaToken || unified2faContainer?.style.display === "block") {
            throw ownerErr;
          }
          try {
            loginData = await loginAsClient(email, pass, deviceId, rememberMe);
            loginRole = "client";
          } catch (clientErr) {
            throw new Error(clientErr.message || ownerErr.message || "Credenciales incorrectas.");
          }
        }

        await finishStaffOrClientLogin(loginData, loginRole, email, pass, rememberMe);
      } catch (err) {
        unifiedLoginError.textContent = err.message || "Credenciales incorrectas.";
        unifiedLoginError.style.display = "block";
      } finally {
        hideExtensionLoader();
        const loginBtn = document.getElementById("unifiedLoginBtn");
        if (!pendingMfaToken) loginBtn.textContent = "Ingresar al Panel";
        loginBtn.style.opacity = "1";
      }
    });
  }

  showExtensionLoader("Preparando tus perfiles...");
  try {
    await checkAuthAndLoad();
  } finally {
    hideExtensionLoader();
  }
  // Sin banner de incógnito (obsoleto).
}

bootstrap();
