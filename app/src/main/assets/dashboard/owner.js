import { initProfileEditor, getProfileData, setProfileData } from "./profileEditor.js";
import { initTeamManager } from "./teamManager.js";


// FIX CRITICO: form.reset() no dispara el evento 'reset' por defecto.
const originalFormReset = HTMLFormElement.prototype.reset;
HTMLFormElement.prototype.reset = function() {
  originalFormReset.call(this);
  this.dispatchEvent(new Event('reset'));
};
console.log('OWNER.JS LOADED');
import { getOwnerToken, getApiBase, clearLocalAuthSession } from "../shared/config.js";
import { logoutSession } from "../shared/api.js";
import {
  sanitizeHexColor,
  sanitizeCssUrl,
  sanitizeImageSrc,
  isSafeHttpUrl,
  isSafeUpdateUrl
} from "../shared/sanitize.js";

const token = await getOwnerToken();

if (!token) {
  window.location.href = "index.html";
}

const API_BASE = await getApiBase();

const state = {
  settings: null,
  categories: [],
  cards: [],
  clients: [],
  clientSearch: "",
  clientGroupFilter: "all",
  clientStatusFilter: "all",
  clientPage: 1,
  clientPageSize: 10,
  profileGroups: [],
  editingCardId: null,
  editingProfileGroupId: null,
  currentLogo: "",
  currentBackground: "",
  currentCardLogo: "",
  currentBanner: "",
  tutorials: []
};

const elements = {
  brandLogoContainer: document.querySelector("#brandLogoContainer"),
  brandLogo: document.querySelector("#brandLogo"),
  brandTitle: document.querySelector("#brandTitle"),
  brandSubtitle: document.querySelector("#brandSubtitle"),
  statsGrid: document.querySelector("#statsGrid"),
  settingsForm: document.querySelector("#settingsForm"),
  titleInput: document.querySelector("#titleInput"),
  subtitleInput: document.querySelector("#subtitleInput"),
  heroTitleInput: document.querySelector("#heroTitleInput"),
  heroHeadlineInput: document.querySelector("#heroHeadlineInput"),
  heroTextInput: document.querySelector("#heroTextInput"),
  sidebarTitleInput: document.querySelector("#sidebarTitleInput"),
  footerNoteInput: document.querySelector("#footerNoteInput"),
  logoFileInput: document.querySelector("#logoFileInput"),
  logoPreview: document.querySelector("#logoPreview"),
  clearLogoBtn: document.querySelector("#clearLogoBtn"),
  backgroundFileInput: document.querySelector("#backgroundFileInput"),
  backgroundPreview: document.querySelector("#backgroundPreview"),
  clearBackgroundBtn: document.querySelector("#clearBackgroundBtn"),
  guestPasswordInput: document.querySelector("#guestPasswordInput"),
  ultraPasswordInput: document.querySelector("#ultraPasswordInput"),
  globalAnnouncementInput: document.querySelector("#globalAnnouncementInput"),
  profileGroupsEnabledInput: document.querySelector("#profileGroupsEnabledInput"),
  minExtensionVersionInput: document.querySelector("#minExtensionVersionInput"),
  latestExtensionVersionInput: document.querySelector("#latestExtensionVersionInput"),
  latestExtensionUrlInput: document.querySelector("#latestExtensionUrlInput"),
  categoryForm: document.querySelector("#categoryForm"),
  categoryNameInput: document.querySelector("#categoryNameInput"),
  categorySlugInput: document.querySelector("#categorySlugInput"),
  categoryAccentInput: document.querySelector("#categoryAccentInput"),
  categoryOrderInput: document.querySelector("#categoryOrderInput"),
  categoryList: document.querySelector("#categoryList"),
  categoryTemplate: document.querySelector("#categoryTemplate"),
  cardForm: document.querySelector("#cardForm"),
  cardFormTitle: document.querySelector("#cardFormTitle"),
  cardNameInput: document.querySelector("#cardNameInput"),
  providerKeyInput: document.querySelector("#providerKeyInput"),
  providerLabelInput: document.querySelector("#providerLabelInput"),
  badgeInput: document.querySelector("#badgeInput"),
  accentInput: document.querySelector("#accentInput"),
  secondaryAccentInput: document.querySelector("#secondaryAccentInput"),
  categorySelect: document.querySelector("#categorySelect"),
  urlInput: document.querySelector("#urlInput"),
  requiresSessionSelect: document.querySelector("#requiresSessionSelect"),
  accessLevelSelect: document.querySelector("#accessLevelSelect"),
  cardProfileGroupsSelect: document.querySelector("#cardProfileGroupsSelect"),
  openAsSelect: document.querySelector("#openAsSelect"),
  notesInput: document.querySelector("#notesInput"),
  ctaInput: document.querySelector("#ctaInput"),
  sortOrderInput: document.querySelector("#sortOrderInput"),
  tutorialUrlInput: document.querySelector("#tutorialUrlInput"),
  enableIncognitoRestartInput: document.querySelector("#enableIncognitoRestartInput"),
  clientCanInjectInput: document.querySelector("#clientCanInjectInput"),
  clearCacheButtonInput: document.querySelector("#clearCacheButtonInput"),
  streamingDrmCleanInput: document.querySelector("#streamingDrmCleanInput"),
  lovableCompatInput: document.querySelector("#lovableCompatInput"),
  chromiumLiteInput: document.querySelector("#chromiumLiteInput"),
  featuredInput: document.querySelector("#featuredInput"),
  activeInput: document.querySelector("#activeInput"),
  cardLogoFileInput: document.querySelector("#cardLogoFileInput"),
  cardLogoPreview: document.querySelector("#cardLogoPreview"),
  clearCardLogoBtn: document.querySelector("#clearCardLogoBtn"),
  bannerFileInput: document.querySelector("#bannerFileInput"),
  bannerPreview: document.querySelector("#bannerPreview"),
  clearBannerBtn: document.querySelector("#clearBannerBtn"),
  saveCardButton: document.querySelector("#saveCardButton"),
  cancelEditButton: document.querySelector("#cancelEditButton"),
  toolGrid: document.querySelector("#toolGrid"),
  toolTemplate: document.querySelector("#toolTemplate"),
  logoutButton: document.querySelector("#logoutButton"),
  loginEmailInput: document.querySelector("#loginEmailInput"),
  loginPasswordInput: document.querySelector("#loginPasswordInput"),
  totpSecretInput: document.querySelector("#totpSecretInput"),
  loginMethodSelect: document.querySelector("#loginMethodSelect"),
  imapPasswordInput: document.querySelector("#imapPasswordInput"),
  blockedSelectorsInput: document.querySelector("#blockedSelectorsInput"),
  openAuthButton: document.querySelector("#openAuthButton"),
  authDialog: document.querySelector("#authDialog"),
  closeAuthButton: document.querySelector("#closeAuthButton"),
  authCardSelect: document.querySelector("#authCardSelect"),
  configureAuthCardButton: document.querySelector("#configureAuthCardButton"),
  authList: document.querySelector("#authList"),
  tutorialForm: document.querySelector("#tutorialForm"),
  tutorialTitle: document.querySelector("#tutorialTitle"),
  tutorialUrl: document.querySelector("#tutorialUrl"),
  tutorialDesc: document.querySelector("#tutorialDesc"),
  tutorialOrder: document.querySelector("#tutorialOrder"),
  tutorialsTableBody: document.querySelector("#tutorialsTableBody"),
  proxyHostInput: document.querySelector("#proxyHostInput"),
  proxyPortInput: document.querySelector("#proxyPortInput"),
  proxyUsernameInput: document.querySelector("#proxyUsernameInput"),
  proxyPasswordInput: document.querySelector("#proxyPasswordInput"),
  testProxyBtn: document.querySelector("#testProxyBtn"),
  clientForm: document.querySelector("#clientForm"),
  clientIdInput: document.querySelector("#clientIdInput"),
  clientEmailInput: document.querySelector("#clientEmailInput"),
  clientPhoneInput: document.querySelector("#clientPhoneInput"),
  clientPasswordInput: document.querySelector("#clientPasswordInput"),
  clientPlanSelect: document.querySelector("#clientPlanSelect"),
  clientProfileGroupSelect: document.querySelector("#clientProfileGroupSelect"),
  clientStatusSelect: document.querySelector("#clientStatusSelect"),
  clientExpiresInput: document.querySelector("#clientExpiresInput"),
  clientModal: document.querySelector("#clientModal"),
  clientModalTitle: document.querySelector("#clientModalTitle"),
  clientModalClose: document.querySelector("#clientModalClose"),
  clientModalCancel: document.querySelector("#clientModalCancel"),
  saveClientBtn: document.querySelector("#saveClientBtn"),
  addClientBtn: document.querySelector("#btnAgregarClienteBtn"),
  generatePasswordBtn: document.querySelector("#generatePasswordBtn"),
  clientSearchInput: document.querySelector("#clientSearchInput"),
  clientGroupFilter: document.querySelector("#clientGroupFilter"),
  clientStatusFilter: document.querySelector("#clientStatusFilter"),
  clientsPrevPage: document.querySelector("#clientsPrevPage"),
  clientsNextPage: document.querySelector("#clientsNextPage"),
  clientsPageIndicator: document.querySelector("#clientsPageIndicator"),
  clientsResultSummary: document.querySelector("#clientsResultSummary"),
  totalClientsCounter: document.querySelector("#totalClientsCounter"),
  activeClientsCounter: document.querySelector("#activeClientsCounter"),
  inactiveClientsCounter: document.querySelector("#inactiveClientsCounter"),
  clientsTableBody: document.querySelector("#clientsTableBody"),
  clientsList: document.querySelector("#clientsList"),
  profileGroupForm: document.querySelector("#profileGroupForm"),
  profileGroupIdInput: document.querySelector("#profileGroupIdInput"),
  profileGroupNameInput: document.querySelector("#profileGroupNameInput"),
  profileGroupDescriptionInput: document.querySelector("#profileGroupDescriptionInput"),
  cancelProfileGroupBtn: document.querySelector("#cancelProfileGroupBtn"),
  saveProfileGroupBtn: document.querySelector("#saveProfileGroupBtn"),
  profileGroupsTableBody: document.querySelector("#profileGroupsTableBody")
};



async function api(path, options = {}) {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  const payload = await response.json();

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      window.location.href = "index.html";
      throw new Error(payload.error || "Sesion no autorizada.");
    }
    const fallback = payload.error || `Error en la API (${response.status})`;
    const apiError = new Error(fallback);
    apiError.status = response.status;
    apiError.code = payload.code || "API_ERROR";
    throw apiError;
  }

  return payload;
}

async function safeOwnerApi(path, fallbackValue) {
  try {
    return await api(path);
  } catch (error) {
    if (error.code === "MFA_SETUP_REQUIRED") {
      throw error;
    }
    console.warn(`Fallo cargando ${path}:`, error.message);
    return typeof fallbackValue === "function" ? fallbackValue(error) : fallbackValue;
  }
}

function resetCardForm() {
  state.editingCardId = null;
  state.currentCardLogo = "";
  state.currentBanner = "";
  elements.cardForm.reset();
  elements.categorySelect.value = "";
  if (elements.requiresSessionSelect) elements.requiresSessionSelect.value = "true";
  elements.accessLevelSelect.value = "standard";
  setSelectedValues(elements.cardProfileGroupsSelect, []);
  elements.openAsSelect.value = "popup";
  if (elements.tutorialUrlInput) elements.tutorialUrlInput.value = "";
  if (elements.enableIncognitoRestartInput) elements.enableIncognitoRestartInput.checked = false;
  if (elements.clientCanInjectInput) elements.clientCanInjectInput.checked = false;
  if (elements.clearCacheButtonInput) elements.clearCacheButtonInput.checked = false;
  if (elements.streamingDrmCleanInput) elements.streamingDrmCleanInput.checked = false;
  if (elements.lovableCompatInput) elements.lovableCompatInput.checked = false;
  if (elements.chromiumLiteInput) elements.chromiumLiteInput.checked = false;
  if (elements.loginEmailInput) elements.loginEmailInput.value = "";
  if (elements.loginPasswordInput) elements.loginPasswordInput.value = "";
  if (elements.totpSecretInput) elements.totpSecretInput.value = "";
  if (elements.imapPasswordInput) elements.imapPasswordInput.value = "";
  if (elements.blockedSelectorsInput) elements.blockedSelectorsInput.value = "";
  if (elements.loginMethodSelect) elements.loginMethodSelect.value = "google";
  if (elements.proxyHostInput) elements.proxyHostInput.value = "";
  if (elements.proxyPortInput) elements.proxyPortInput.value = "";
  if (elements.proxyUsernameInput) elements.proxyUsernameInput.value = "";
  if (elements.proxyPasswordInput) elements.proxyPasswordInput.value = "";
  setProfileData({ fingerprint_config: {} });
  elements.activeInput.checked = true;
  elements.cardFormTitle.textContent = "Crear tarjeta";
  elements.saveCardButton.textContent = "Guardar tarjeta";
  elements.cancelEditButton.classList.add("hidden");
  updateImagePreview(elements.cardLogoPreview, state.currentCardLogo);
  updateImagePreview(elements.bannerPreview, state.currentBanner);
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

function formatTotpCode(code = "") {
  const normalized = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return "------";
  return `${normalized.slice(0, 3)} ${normalized.slice(3)}`;
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "categoria";
}

function getSelectedValues(select) {
  if (!select) return [];
  return [...select.selectedOptions]
    .map((option) => Number(option.value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function setSelectedValues(select, values = []) {
  if (!select) return;
  const selected = new Set((values || []).map((value) => String(value)));
  [...select.options].forEach((option) => {
    option.selected = selected.has(option.value);
  });
}

function profileGroupLabel(client) {
  return client.profile_group_name || "Sin grupo";
}

function activateTeamTab(tabName = "clientes") {
  const teamPanel = document.getElementById("teamPanel");
  if (!teamPanel) return;

  teamPanel.querySelectorAll(".dic-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === tabName);
  });
  teamPanel.querySelectorAll(".dic-tab-content").forEach((content) => {
    content.classList.toggle("active", content.id === `tab-${tabName}`);
  });
}

function activateOwnerView(targetSelector = "#statsGrid") {
  try {
    
    const target = document.querySelector(targetSelector) || elements.statsGrid;

    document.querySelectorAll(".owner-view").forEach((section) => {
      const isActive = section === target;
      section.classList.toggle("active", isActive);
      if (isActive) {
        section.style.display = section.id === "statsGrid" ? "grid" : "block";
      } else {
        section.style.display = "none";
      }
    });

    document.querySelectorAll(".sidebar-nav a").forEach((item) => {
      item.classList.toggle("active", item.getAttribute("href") === `#${target.id}`);
    });

    const hero = document.querySelector(".owner-hero");
    if (hero) {
      hero.style.display = target.id === "statsGrid" ? "flex" : "none";
    }

    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } catch (err) {
    alert("ERROR en navegacion: " + err.message);
  }
}

function fillCategorySelect() {
  elements.categorySelect.innerHTML = ['<option value="">Sin categoría</option>']
    .concat(state.categories.map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`))
    .join("");
}

function fillProfileGroupControls() {
  const clientOptions = ['<option value="">Sin grupo (acceso general)</option>']
    .concat(state.profileGroups.map((group) => `<option value="${group.id}">${escapeHtml(group.name)}</option>`))
    .join("");
  const memberOptions = ['<option value="Todos los grupos">Todos los grupos</option>']
    .concat(state.profileGroups.map((group) => `<option value="${escapeHtml(group.name)}">${escapeHtml(group.name)}</option>`))
    .join("");

  if (elements.clientProfileGroupSelect) {
    const current = elements.clientProfileGroupSelect.value;
    elements.clientProfileGroupSelect.innerHTML = clientOptions;
    elements.clientProfileGroupSelect.value = current || "";
  }

  if (elements.clientGroupFilter) {
    const currentFilter = elements.clientGroupFilter.value || state.clientGroupFilter;
    elements.clientGroupFilter.innerHTML = [
      '<option value="all">Todos los grupos</option>',
      '<option value="none">Sin grupo</option>',
      ...state.profileGroups.map((group) => `<option value="${group.id}">${escapeHtml(group.name)}</option>`)
    ].join("");
    elements.clientGroupFilter.value = [...elements.clientGroupFilter.options]
      .some((option) => option.value === currentFilter) ? currentFilter : "all";
    state.clientGroupFilter = elements.clientGroupFilter.value;
  }

  if (elements.cardProfileGroupsSelect) {
    const selected = getSelectedValues(elements.cardProfileGroupsSelect);
    elements.cardProfileGroupsSelect.innerHTML = state.profileGroups
      .map((group) => `<option value="${group.id}">${escapeHtml(group.name)}</option>`)
      .join("");
    setSelectedValues(elements.cardProfileGroupsSelect, selected);
  }

  const memberProfileSelect = document.getElementById("memberProfileGroup");
  if (memberProfileSelect) {
    const current = memberProfileSelect.value;
    memberProfileSelect.innerHTML = memberOptions;
    memberProfileSelect.value = current || "Todos los grupos";
  }
}

function renderStats(stats) {
  elements.statsGrid.innerHTML = `
    <div class="stat"><strong>${stats.cards}</strong><span class="muted">Tarjetas</span></div>
    <div class="stat"><strong>${stats.categories}</strong><span class="muted">Categorías</span></div>
    <div class="stat"><strong>${stats.launches}</strong><span class="muted">Aperturas</span></div>
  `;
}

function renderSettings() {
  if (!state.settings) {
    return;
  }

  // Actualizar UI del panel superior izquierdo (como el dashboard de cliente)
  if (elements.brandLogoContainer && elements.brandLogo) {
    const safeBrandLogo = sanitizeImageSrc(state.settings.logo_url);
    if (safeBrandLogo) {
      elements.brandLogo.src = safeBrandLogo;
      elements.brandLogoContainer.classList.remove("hidden");
    } else {
      elements.brandLogoContainer.classList.add("hidden");
    }
  }
  
  if (elements.brandTitle && state.settings.company_name) {
    elements.brandTitle.textContent = state.settings.company_name;
  }

  // Establecer el fondo idéntico al cliente
  state.currentBackground = state.settings.background_url || "";
  const safeBackground = sanitizeCssUrl(state.currentBackground);
  if (safeBackground) {
    document.body.style.backgroundImage = `linear-gradient(rgba(6, 10, 24, 0.85), rgba(6, 10, 24, 0.95)), url("${safeBackground}")`;
    document.body.style.backgroundSize = "cover";
    document.body.style.backgroundPosition = "center";
    document.body.style.backgroundAttachment = "fixed";
  } else {
    document.body.style.backgroundImage = "radial-gradient(circle at top, #0A0F24, #04060e)";
  }

  // Formularios del panel de ajustes
  if (elements.titleInput) elements.titleInput.value = state.settings.company_name || "";
  if (elements.subtitleInput) elements.subtitleInput.value = state.settings.welcome_message || "";
  if (elements.announcementInput) elements.announcementInput.value = state.settings.global_announcement || "";
  if (elements.supportUrlInput) elements.supportUrlInput.value = state.settings.support_url || "";
  if (elements.globalAnnouncementInput) elements.globalAnnouncementInput.value = state.settings.global_announcement || "";
  if (elements.profileGroupsEnabledInput) elements.profileGroupsEnabledInput.checked = Boolean(state.settings.profile_groups_enabled);

  state.currentLogo = state.settings.logo_url || "";
  
  if (elements.logoPreview) {
    const safeLogo = sanitizeImageSrc(state.currentLogo);
    if (safeLogo) {
      elements.logoPreview.src = safeLogo;
      elements.logoPreview.style.display = "block";
      const fallback = elements.logoPreview.nextElementSibling;
      if (fallback) fallback.style.display = "none";
    } else {
      elements.logoPreview.style.display = "none";
      const fallback = elements.logoPreview.nextElementSibling;
      if (fallback) fallback.style.display = "flex";
    }
  }
}

function renderCategories() {
  elements.categoryList.innerHTML = "";
  const fragment = document.createDocumentFragment();

  state.categories.forEach((category) => {
    const template = elements.categoryTemplate.content.cloneNode(true);
    const accent = sanitizeHexColor(category.accent);
    template.querySelector(".category-accent").style.background = `linear-gradient(90deg, ${accent}, rgba(0, 240, 255, 0.9))`;
    template.querySelector(".category-name").textContent = category.name;
    template.querySelector(".meta").textContent = `${category.slug} | ${accent} | orden ${category.sort_order}`;
    template.querySelector(".category-delete").addEventListener("click", async () => {
      if (!confirm(`Borrar categoría "${category.name}"?`)) {
        return;
      }

      await api(`/api/owner/categories/${category.id}`, { method: "DELETE" });
      await initProfileEditor();
      initTeamManager();
    loadAll();
    });
    fragment.appendChild(template);
  });

  elements.categoryList.appendChild(fragment);
}

window.updateImagePreview = function(imgElement, urlOrBase64) {
  if (!imgElement) return;
  const fallback = imgElement.nextElementSibling;
  const safeSrc = sanitizeImageSrc(urlOrBase64);
  if (safeSrc) {
    imgElement.src = safeSrc;
    imgElement.style.display = "block";
    if (fallback) fallback.style.display = "none";
  } else {
    imgElement.src = "";
    imgElement.style.display = "none";
    if (fallback) fallback.style.display = "flex";
  }
}

function fillCardForm(card) {
  state.editingCardId = card.id;
  elements.cardNameInput.value = card.name || "";
  elements.providerKeyInput.value = card.provider_key || "";
  elements.providerLabelInput.value = card.provider_label || "";
  elements.badgeInput.value = card.badge || "";
  elements.accentInput.value = card.accent || "";
  elements.secondaryAccentInput.value = card.secondary_accent || "";
  elements.categorySelect.value = card.category_id || "";
  elements.urlInput.value = card.url || "";
  if (elements.requiresSessionSelect) {
    elements.requiresSessionSelect.value = card.requires_session === false ? "false" : "true";
  }
  elements.accessLevelSelect.value = card.access_level || "standard";
  setSelectedValues(elements.cardProfileGroupsSelect, card.profile_group_ids || []);
  elements.openAsSelect.value = card.open_as || "popup";
  elements.notesInput.value = card.notes || "";
  elements.ctaInput.value = card.cta_label || "";
  elements.sortOrderInput.value = card.sort_order || 0;
  if (elements.tutorialUrlInput) elements.tutorialUrlInput.value = card.tutorial_url || "";
  if (elements.enableIncognitoRestartInput) elements.enableIncognitoRestartInput.checked = Boolean(card.enable_incognito_restart);
  if (elements.clientCanInjectInput) elements.clientCanInjectInput.checked = Boolean(card.client_can_inject);
  if (elements.clearCacheButtonInput) elements.clearCacheButtonInput.checked = Boolean(card.clear_cache_button);
  {
    let fp = card.fingerprint_config;
    if (typeof fp === "string") {
      try { fp = JSON.parse(fp); } catch { fp = {}; }
    }
    if (!fp || typeof fp !== "object") fp = {};
    if (elements.streamingDrmCleanInput) {
      elements.streamingDrmCleanInput.checked = Boolean(
        card.streaming_drm_clean || card.streamingDrmClean || fp.streaming_drm_clean || fp.streamingDrmClean
      );
      // Si el checkbox está ON al cargar, cachear ya (API a veces no manda el flag al dashboard)
      if (elements.streamingDrmCleanInput.checked && card.id) {
        try {
          chrome.runtime.sendMessage({
            type: "SET_STREAMING_DRM_FLAG",
            cardId: card.id,
            enabled: true
          });
        } catch { /* ignore */ }
      }
    }
    if (elements.lovableCompatInput) {
      elements.lovableCompatInput.checked = Boolean(
        card.lovable_compat || card.lovableCompat || fp.lovable_compat || fp.lovableCompat
      );
      if (elements.lovableCompatInput.checked && card.id) {
        try {
          const map = JSON.parse(localStorage.getItem("iamax_lovable_compat_cards") || "{}");
          map[String(card.id)] = true;
          localStorage.setItem("iamax_lovable_compat_cards", JSON.stringify(map));
        } catch { /* ignore */ }
      }
    }
    if (elements.chromiumLiteInput) {
      elements.chromiumLiteInput.checked = Boolean(
        card.chromium_lite || card.chromiumLite || fp.chromium_lite || fp.chromiumLite || fp.mac_lite || fp.macLite
      );
      if (elements.chromiumLiteInput.checked && card.id) {
        try {
          const map = JSON.parse(localStorage.getItem("iamax_chromium_lite_cards") || "{}");
          map[String(card.id)] = true;
          localStorage.setItem("iamax_chromium_lite_cards", JSON.stringify(map));
        } catch { /* ignore */ }
      }
    }
  }
  elements.featuredInput.checked = Boolean(card.is_featured);
  elements.activeInput.checked = Boolean(card.is_active);
  if (elements.loginEmailInput) elements.loginEmailInput.value = card.login_email || "";
  if (elements.loginPasswordInput) elements.loginPasswordInput.value = card.login_password || "";
  if (elements.totpSecretInput) elements.totpSecretInput.value = card.totp_secret || "";
  if (elements.imapPasswordInput) elements.imapPasswordInput.value = card.imap_password || "";
  if (elements.blockedSelectorsInput) elements.blockedSelectorsInput.value = card.blocked_selectors || "";
  if (elements.loginMethodSelect) elements.loginMethodSelect.value = card.login_method || "google";
  if (elements.proxyHostInput) elements.proxyHostInput.value = card.proxy_host || "";
  if (elements.proxyPortInput) elements.proxyPortInput.value = card.proxy_port || "";
  if (elements.proxyUsernameInput) elements.proxyUsernameInput.value = card.proxy_username || "";
  if (elements.proxyPasswordInput) elements.proxyPasswordInput.value = card.proxy_password || "";

  if (document.getElementById("userAgentInput")) document.getElementById("userAgentInput").value = card.user_agent || "";
  if (document.getElementById("acceptLanguageInput")) document.getElementById("acceptLanguageInput").value = card.accept_language || "";
  if (document.getElementById("webrtcModeSelect")) document.getElementById("webrtcModeSelect").value = card.webrtc_mode || "disable_non_proxied_udp";
  setProfileData(card);
  state.currentCardLogo = card.logo_base64 || "";
  state.currentBanner = card.banner_base64 || "";
  updateImagePreview(elements.cardLogoPreview, state.currentCardLogo);
  updateImagePreview(elements.bannerPreview, state.currentBanner);
  elements.cardFormTitle.textContent = "Editar tarjeta";
  elements.saveCardButton.textContent = "Guardar cambios";
  elements.cancelEditButton.classList.remove("hidden");
  activateOwnerView("#cardPanel");
}

function renderCards() {
  elements.toolGrid.innerHTML = "";
  const fragment = document.createDocumentFragment();

  state.cards.forEach((card) => {
    const template = elements.toolTemplate.content.cloneNode(true);
    const cardElement = template.querySelector(".owner-tool-card");
    const banner = template.querySelector(".tool-banner");
    const badge = template.querySelector(".tool-badge");
    const actions = template.querySelector(".kaizen-actions");
    const optionsButton = template.querySelector(".options-btn");
    cardElement.style.setProperty("--card-accent", sanitizeHexColor(card.accent, "#7c4dff"));
    cardElement.style.setProperty("--card-accent-2", sanitizeHexColor(card.secondary_accent, "#0f5df5"));

    if (!card.is_active) {
      cardElement.classList.add("is-inactive");
    }
    if (card.reported_broken) {
      cardElement.classList.add("is-alert");
    }

    const safeBanner = sanitizeCssUrl(card.banner_base64);
    if (safeBanner) {
      banner.style.background = `url("${safeBanner}") center/cover no-repeat`;
    } else {
      banner.style.background = `
        linear-gradient(135deg, ${sanitizeHexColor(card.accent, "#7c4dff")}, ${sanitizeHexColor(card.secondary_accent, "#0f5df5")})
      `;
    }
    if (card.logo_base64) {
      const logo = document.createElement("img");
      logo.src = sanitizeImageSrc(card.logo_base64);
      logo.alt = `${card.name || "Tarjeta"} logo`;
      badge.replaceChildren(logo);
      badge.style.background = "transparent";
    } else {
      badge.style.background = `linear-gradient(135deg, ${sanitizeHexColor(card.accent, "#24d5ae")}, #d5f6ef)`;
      badge.textContent = card.badge || "IA";
    }

    template.querySelector(".tool-category").textContent = card.category_name || "Sin categoría";
    template.querySelector(".tool-name").textContent = card.name;
    template.querySelector(".tool-notes").textContent = card.notes || "Sin descripción agregada.";

    const statusPill = `<span class="status-pill">${card.is_active ? "Activa" : "Inactiva"}</span>`;
    const ultraPill = card.access_level === "ultra" ? `<span class="status-pill ultra">Ultra</span>` : "";
    const alertPill = card.reported_broken ? `<span class="status-pill danger">Reportada</span>` : "";
    const groupPill = (card.profile_group_names || []).length
      ? `<span class="status-pill">${escapeHtml(card.profile_group_names.join(", "))}</span>`
      : "";
    let sessionPill = "";

    if (card.session_updated_at) {
      const days = Math.floor((new Date() - new Date(card.session_updated_at)) / (1000 * 60 * 60 * 24));
      if (days > 7) {
        sessionPill = `<span class="status-pill warning">Sesión hace ${days} días</span>`;
      } else if (days === 0) {
        sessionPill = `<span class="status-pill">Sesión hoy</span>`;
      } else {
        sessionPill = `<span class="status-pill">Sesión hace ${days} días</span>`;
      }
    }

    template.querySelector(".meta").innerHTML = `${alertPill}${ultraPill}${statusPill}${groupPill}<span>${escapeHtml(card.provider_label || "Herramienta")}</span>${sessionPill}`;

    optionsButton.addEventListener("click", (event) => {
      event.stopPropagation();
      actions.classList.toggle("hidden");
      optionsButton.textContent = actions.classList.contains("hidden") ? "Opciones" : "Ocultar";
    });

    template.querySelector(".edit-button").addEventListener("click", () => fillCardForm(card));
    template.querySelector(".duplicate-button").addEventListener("click", async () => {
      await api(`/api/owner/cards/${card.id}/duplicate`, { method: "POST" });
      await loadAll();
    });
    template.querySelector(".delete-button").addEventListener("click", async () => {
      if (!confirm(`Borrar tarjeta "${card.name}"?`)) {
        return;
      }

      await api(`/api/owner/cards/${card.id}`, { method: "DELETE" });
      if (state.editingCardId === card.id) {
        resetCardForm();
      }
      await loadAll();
    });

    addCardMotion(cardElement, state.cards.indexOf(card));
    fragment.appendChild(template);
  });

  elements.toolGrid.appendChild(fragment);
  activateScrollMotion(elements.toolGrid);
}

function resetProfileGroupForm() {
  state.editingProfileGroupId = null;
  if (elements.profileGroupForm) elements.profileGroupForm.reset();
  if (elements.profileGroupIdInput) elements.profileGroupIdInput.value = "";
  if (elements.saveProfileGroupBtn) elements.saveProfileGroupBtn.textContent = "Guardar grupo";
  elements.cancelProfileGroupBtn?.classList.add("hidden");
}

function renderProfileGroups() {
  if (!elements.profileGroupsTableBody) return;

  if (!state.profileGroups.length) {
    elements.profileGroupsTableBody.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center;">No hay grupos creados. Los clientes siguen en Todos los grupos.</td></tr>';
    return;
  }

  elements.profileGroupsTableBody.innerHTML = state.profileGroups.map((group) => `
    <tr>
      <td><strong>${escapeHtml(group.name)}</strong><div class="info-id">ID: ${group.id}</div></td>
      <td>${escapeHtml(group.description || "--")}</td>
      <td>${Number(group.client_count || 0)}</td>
      <td>${Number(group.card_count || 0)}</td>
      <td>
        <button class="kaizen-btn edit-profile-group-btn" type="button" data-id="${group.id}">Editar</button>
        <button class="kaizen-btn danger del-profile-group-btn" type="button" data-id="${group.id}">Borrar</button>
      </td>
    </tr>
  `).join("");

  elements.profileGroupsTableBody.querySelectorAll(".edit-profile-group-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const group = state.profileGroups.find((item) => String(item.id) === button.dataset.id);
      if (!group) return;
      state.editingProfileGroupId = group.id;
      elements.profileGroupIdInput.value = group.id;
      elements.profileGroupNameInput.value = group.name || "";
      elements.profileGroupDescriptionInput.value = group.description || "";
      if (elements.saveProfileGroupBtn) elements.saveProfileGroupBtn.textContent = "Guardar cambios";
      elements.cancelProfileGroupBtn?.classList.remove("hidden");
      activateOwnerView("#teamPanel");
      activateTeamTab("grupos");
    });
  });

  elements.profileGroupsTableBody.querySelectorAll(".del-profile-group-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const group = state.profileGroups.find((item) => String(item.id) === button.dataset.id);
      if (!group) return;
      if (!confirm(`Borrar grupo "${group.name}"? Los clientes asignados volveran a Todos los grupos.`)) return;
      await api(`/api/owner/profile-groups/${group.id}`, { method: "DELETE" });
      resetProfileGroupForm();
      await loadAll();
      await loadClients();
    });
  });
}

function animateLiveNumbers(root = document) {
  root.querySelectorAll(".stat strong").forEach((element) => {
    const target = Number(String(element.textContent || "0").replace(/[^\d.-]/g, "")) || 0;
    const duration = 850;
    const start = performance.now();
    element.classList.add("live-number");

    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      element.textContent = Math.round(target * eased).toLocaleString("es");
      if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  });
}

function addCardMotion(cardEl, index = 0) {
  cardEl.style.setProperty("--motion-delay", `${Math.min(index * 65, 420)}ms`);

  cardEl.addEventListener("pointermove", (event) => {
    if (window.matchMedia("(max-width: 820px)").matches) return;
    const rect = cardEl.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    cardEl.classList.add("is-tilting");
    cardEl.style.transform = `translateY(-5px) rotateX(${(-y * 4).toFixed(2)}deg) rotateY(${(x * 5).toFixed(2)}deg)`;
  });

  cardEl.addEventListener("pointerleave", () => {
    cardEl.classList.remove("is-tilting");
    cardEl.style.transform = "";
  });
}

function activateScrollMotion(root = document) {
  const cards = [...root.querySelectorAll(".kaizen-card")];
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
  }, { threshold: 0.14 });

  cards.forEach((card) => observer.observe(card));
}

async function loadAll() {
  const [stats, settings, categories, cards, clients, profileGroups, tutorialsResp, systemConfig] = await Promise.all([
    safeOwnerApi("/api/owner/stats", { users: 0, live: 0, revenue: 0, cards: 0 }),
    safeOwnerApi("/api/owner/settings", {}),
    safeOwnerApi("/api/owner/categories", []),
    safeOwnerApi("/api/owner/cards", []),
    safeOwnerApi("/api/owner/clients", []),
    safeOwnerApi("/api/owner/profile-groups", []),
    safeOwnerApi("/api/public/tutorials", { tutorials: [] }),
    safeOwnerApi("/api/owner/system-config", { minExtensionVersion: "1.0.0" })
  ]);

  state.settings = settings;
  state.categories = categories;
  state.cards = cards;
  state.clients = clients;
  state.profileGroups = profileGroups;
  state.tutorials = tutorialsResp.tutorials || [];
  
  if (elements.minExtensionVersionInput) {
    elements.minExtensionVersionInput.value = systemConfig.minExtensionVersion || "1.0.0";
    elements.latestExtensionVersionInput.value = systemConfig.latestExtensionVersion || "1.0.0";
    elements.latestExtensionUrlInput.value = systemConfig.latestExtensionUrl || "";
  }

  renderStats(stats);
  animateLiveNumbers(elements.statsGrid);
  renderSettings();
  fillCategorySelect();
  fillProfileGroupControls();
  renderClients();
  renderProfileGroups();
  renderCategories();
  renderCards();
  renderTutorials();
}

document.querySelectorAll(".sidebar-nav a, .owner-hero-actions a[href^='#']").forEach((anchor) => {
  anchor.addEventListener("click", (event) => {
    const targetSelector = anchor.getAttribute("href");
    const target = targetSelector ? document.querySelector(targetSelector) : null;

    if (!target) {
      return;
    }

    event.preventDefault();
    activateOwnerView(targetSelector);
  });
});

function getExtensionConfigPayload() {
  const latestExtensionUrl = elements.latestExtensionUrlInput.value.trim() || "";
  if (latestExtensionUrl && !isSafeUpdateUrl(latestExtensionUrl)) {
    throw new Error("URL de actualización no permitida. Use HTTPS en iamaxbotcrm.online, iamax.com o localhost.");
  }

  return {
    minExtensionVersion: elements.minExtensionVersionInput.value.trim() || "1.0.0",
    latestExtensionVersion: elements.latestExtensionVersionInput.value.trim() || "1.0.0",
    latestExtensionUrl
  };
}

elements.settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await api("/api/owner/settings", {
      method: "PUT",
      body: JSON.stringify({
        title: elements.titleInput.value.trim(),
        subtitle: elements.subtitleInput.value.trim(),
        hero_title: elements.heroTitleInput.value.trim(),
        hero_headline: elements.heroHeadlineInput.value.trim(),
        hero_text: elements.heroTextInput.value.trim(),
        sidebar_title: elements.sidebarTitleInput.value.trim(),
        footer_note: elements.footerNoteInput.value.trim(),
        logo_url: state.currentLogo || "",
        background_url: state.currentBackground || "",
        guest_password: elements.guestPasswordInput.value.trim(),
        ultra_password: elements.ultraPasswordInput.value.trim(),
        global_announcement: elements.globalAnnouncementInput.value.trim(),
        profile_groups_enabled: elements.profileGroupsEnabledInput?.checked || false
      })
    });

    await api("/api/owner/system-config", {
      method: "POST",
      body: JSON.stringify(getExtensionConfigPayload())
    });

    await loadAll();
  } catch (error) {
    alert(error.message || "No se pudieron guardar los ajustes.");
  }
});

const buildExtensionBtn = document.getElementById("buildExtensionBtn");
if (buildExtensionBtn) {
  buildExtensionBtn.addEventListener("click", async () => {
    buildExtensionBtn.textContent = "Fabricando... (Puede tardar 15s)";
    buildExtensionBtn.disabled = true;

    try {
      // First save the settings so the server has the latest version
      await api("/api/owner/system-config", {
        method: "POST",
        body: JSON.stringify(getExtensionConfigPayload())
      });

      // Now request the file download
      if (!token) throw new Error("No hay token de sesión");

      const response = await fetch(`${API_BASE}/api/owner/build-extension`, {
        headers: { "Authorization": `Bearer ${token}` }
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Error ${response.status}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `IAmax-Launcher-v${elements.latestExtensionVersionInput.value.trim() || "1.0.0"}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert("Error al fabricar la extensión: " + error.message);
    } finally {
      buildExtensionBtn.textContent = "Generar y Descargar .ZIP";
      buildExtensionBtn.disabled = false;
    }
  });
}

elements.categoryForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const categoryName = elements.categoryNameInput.value.trim();
  const categorySlug = elements.categorySlugInput.value.trim() || slugify(categoryName);

  await api("/api/owner/categories", {
    method: "POST",
    body: JSON.stringify({
      name: categoryName,
      slug: categorySlug,
      accent: elements.categoryAccentInput.value.trim(),
      sort_order: Number(elements.categoryOrderInput.value || 0)
    })
  });

  elements.categoryForm.reset();
  elements.categoryOrderInput.value = "0";
  await loadAll();
});

/** Modal oscuro IAmax de resultado del test (nunca alert blanco del SO) */
function showProxyTestResult({
  ok = false,
  ip = "",
  latency = null,
  protocol = "http",
  host = "",
  port = "",
  name = "",
  error = "",
  country = "",
  countryCode = "",
  city = "",
  countryLabel = ""
} = {}) {
  const modal = document.getElementById("proxyTestResultModal");
  if (!modal) {
    const geo = countryLabel || [city, country].filter(Boolean).join(", ") || countryCode;
    if (ok) alert(`Proxy OK\nIP: ${ip}\nPaís: ${geo || "—"}\nLatencia: ${latency} ms`);
    else alert(`Proxy falló\n${error || "Sin detalle"}`);
    return;
  }
  const status = document.getElementById("proxyTestStatus");
  const icon = document.getElementById("proxyTestIcon");
  const headline = document.getElementById("proxyTestHeadline");
  const subline = document.getElementById("proxyTestSubline");
  const ipEl = document.getElementById("proxyTestIp");
  const countryEl = document.getElementById("proxyTestCountry");
  const latEl = document.getElementById("proxyTestLatency");
  const epEl = document.getElementById("proxyTestEndpoint");
  const hint = document.getElementById("proxyTestHint");
  const errEl = document.getElementById("proxyTestError");
  const title = document.getElementById("proxyTestTitle");
  const endpoint = `${protocol}://${host}:${port}`;
  const geo =
    countryLabel
    || [city, country].filter(Boolean).join(", ")
    || (countryCode ? countryCode : "")
    || "";

  status?.classList.toggle("is-fail", !ok);
  status?.classList.toggle("is-ok", ok);
  if (icon) icon.textContent = ok ? "✓" : "!";
  if (title) title.textContent = ok ? "Proxy funcionando" : "Proxy no responde";
  if (headline) headline.textContent = ok ? (name ? `${name} · OK` : "Proxy OK") : "Proxy falló";
  if (subline) {
    subline.textContent = ok
      ? (geo ? `Salida en ${geo}` : "IP de salida verificada")
      : "Revisa host, puerto, usuario/contraseña o tipo (HTTP/SOCKS5).";
  }
  if (ipEl) ipEl.textContent = ok && ip ? ip : "—";
  if (countryEl) {
    countryEl.textContent = ok && geo
      ? (countryCode ? `${countryCode} · ${geo}` : geo)
      : "—";
  }
  if (latEl) {
    latEl.textContent = ok && latency != null ? `${latency} ms` : "—";
    latEl.style.color = ok && latency != null && Number(latency) < 200 ? "#6ee7b7" : "#e2e8f0";
  }
  if (epEl) epEl.textContent = endpoint;
  if (hint) {
    hint.classList.toggle("hidden", !ok);
    hint.textContent = ok
      ? "Asigna este proxy a la tarjeta. Las herramientas deben salir por esa IP y país."
      : "";
  }
  if (errEl) {
    if (!ok && error) {
      errEl.textContent = error;
      errEl.classList.remove("hidden");
    } else {
      errEl.textContent = "";
      errEl.classList.add("hidden");
    }
  }
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeProxyTestResult() {
  const modal = document.getElementById("proxyTestResultModal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

document.getElementById("proxyTestResultClose")?.addEventListener("click", closeProxyTestResult);
document.getElementById("proxyTestResultOk")?.addEventListener("click", closeProxyTestResult);
document.getElementById("proxyTestResultModal")?.addEventListener("click", (e) => {
  if (e.target?.id === "proxyTestResultModal") closeProxyTestResult();
});
document.getElementById("proxyTestCopyIp")?.addEventListener("click", async () => {
  const ip = document.getElementById("proxyTestIp")?.textContent?.trim();
  if (!ip || ip === "—") return;
  try {
    await navigator.clipboard.writeText(ip);
    const btn = document.getElementById("proxyTestCopyIp");
    if (btn) {
      const prev = btn.textContent;
      btn.textContent = "Copiado";
      setTimeout(() => { btn.textContent = prev || "Copiar"; }, 1500);
    }
  } catch {
    /* ignore */
  }
});

/** Testea proxy del formulario de tarjeta: IP de salida + latencia */
async function testCardProxyFromForm() {
  const btn = elements.testProxyBtn;
  if (!btn) return;

  const host = elements.proxyHostInput?.value?.trim() || "";
  const port = elements.proxyPortInput?.value?.trim() || "";
  const username = elements.proxyUsernameInput?.value?.trim() || "";
  const password = elements.proxyPasswordInput?.value || "";

  // Si modo "guardado", tomar del select
  const typeBtn = document.querySelector(".proxy-type-group .seg.active");
  const proxyType = typeBtn?.dataset?.type || "none";
  let pHost = host;
  let pPort = port;
  let pUser = username;
  let pPass = password;
  let pName = "";

  if (proxyType === "none") {
    showProxyTestResult({
      ok: false,
      error: "Selecciona un proxy (Guardado o Personalizado) y rellena host/puerto."
    });
    return;
  }
  if (proxyType === "saved") {
    const sel = document.getElementById("savedProxySelect");
    const id = sel?.value;
    const saved = window.ProxyManager?.getProxy?.(id) || null;
    if (!saved) {
      showProxyTestResult({ ok: false, error: "Elige un proxy guardado de la lista." });
      return;
    }
    pHost = saved.host || "";
    pPort = String(saved.port || "");
    pUser = saved.user || saved.username || "";
    pPass = saved.password || saved.pass || "";
    pName = saved.name || "";
  }

  if (!pHost || !pPort) {
    showProxyTestResult({ ok: false, error: "Falta host o puerto del proxy." });
    return;
  }

  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Verificando IP…";
  try {
    let pProtocol = "http";
    if (proxyType === "saved") {
      const sel = document.getElementById("savedProxySelect");
      const saved = window.ProxyManager?.getProxy?.(sel?.value) || null;
      pProtocol = String(saved?.type || saved?.protocol || "http").toLowerCase();
    }
    if (/socks/i.test(pHost)) pProtocol = /socks4/i.test(pHost) ? "socks4" : "socks5";

    const result = await api("/api/owner/test-proxy", {
      method: "POST",
      body: JSON.stringify({
        host: pHost,
        port: pPort,
        username: pUser,
        password: pPass,
        protocol: pProtocol,
        proxy_type: pProtocol
      })
    });
    if (result.working && result.ip) {
      const geoShort = result.countryCode || result.country || "";
      btn.textContent = geoShort
        ? `✅ ${result.ip} · ${geoShort}`
        : `✅ ${result.ip} · ${result.latency}ms`;
      btn.style.color = "#22c55e";
      showProxyTestResult({
        ok: true,
        ip: result.ip,
        latency: result.latency,
        protocol: pProtocol,
        host: pHost,
        port: pPort,
        name: pName,
        country: result.country || "",
        countryCode: result.countryCode || "",
        city: result.city || "",
        countryLabel: result.countryLabel || ""
      });
    } else {
      btn.textContent = "❌ Proxy falló";
      btn.style.color = "#ef4444";
      showProxyTestResult({
        ok: false,
        protocol: pProtocol,
        host: pHost,
        port: pPort,
        name: pName,
        error: result.error || "Sin detalle"
      });
    }
  } catch (error) {
    btn.textContent = "❌ Error";
    btn.style.color = "#ef4444";
    showProxyTestResult({
      ok: false,
      host: pHost,
      port: pPort,
      error: error.message || String(error)
    });
  }
  setTimeout(() => {
    btn.textContent = prev || "🌐 Testear IP del proxy";
    btn.style.color = "";
    btn.disabled = false;
  }, 6000);
}

elements.testProxyBtn?.addEventListener("click", () => {
  testCardProxyFromForm();
});

elements.cancelEditButton.addEventListener("click", () => {
  resetCardForm();
});

elements.cardForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const selectedCategory = state.categories.find((category) => String(category.id) === elements.categorySelect.value);

  const payload = {
    category_id: elements.categorySelect?.value ? Number(elements.categorySelect.value) : null,
    provider_key: elements.providerKeyInput?.value?.trim() || "",
    provider_label: elements.providerLabelInput?.value?.trim() || "",
    name: elements.cardNameInput?.value?.trim() || "",
    badge: elements.badgeInput?.value?.trim() || "",
    accent: elements.accentInput?.value?.trim() || "",
    secondary_accent: elements.secondaryAccentInput?.value?.trim() || "",
    url: elements.urlInput?.value?.trim() || "",
    notes: elements.notesInput?.value?.trim() || "",
    cta_label: elements.ctaInput?.value?.trim() || "",
    is_featured: elements.featuredInput?.checked || false,
    is_active: elements.activeInput?.checked !== false, // Defaults to true
    sort_order: Number(elements.sortOrderInput?.value || 0),
    logo_base64: state.currentCardLogo,
    banner_base64: state.currentBanner,
    access_level: elements.accessLevelSelect?.value || "standard",
    open_as: elements.openAsSelect?.value || "popup",
    requires_session: elements.requiresSessionSelect ? elements.requiresSessionSelect.value === "true" : true,
    category: selectedCategory?.name || "HERRAMIENTAS",
    login_email: elements.loginEmailInput ? elements.loginEmailInput.value.trim() : "",
    login_password: elements.loginPasswordInput ? elements.loginPasswordInput.value.trim() : "",
    totp_secret: elements.totpSecretInput ? elements.totpSecretInput.value.trim() : "",
    login_method: elements.loginMethodSelect ? elements.loginMethodSelect.value : "google",
    imap_password: elements.imapPasswordInput ? elements.imapPasswordInput.value.trim() : "",
    blocked_selectors: elements.blockedSelectorsInput ? elements.blockedSelectorsInput.value.trim() : "",
    proxy_host: elements.proxyHostInput ? elements.proxyHostInput.value.trim() : "",
    proxy_port: elements.proxyPortInput ? elements.proxyPortInput.value.trim() : "",
    proxy_username: elements.proxyUsernameInput ? elements.proxyUsernameInput.value.trim() : "",
    proxy_password: elements.proxyPasswordInput ? elements.proxyPasswordInput.value.trim() : "",
    user_agent: document.getElementById("userAgentInput") ? document.getElementById("userAgentInput").value.trim() : "",
    accept_language: document.getElementById("acceptLanguageInput") ? document.getElementById("acceptLanguageInput").value.trim() : "",
    webrtc_mode: document.getElementById("webrtcModeSelect") ? document.getElementById("webrtcModeSelect").value : "disable_non_proxied_udp",
    tutorial_url: elements.tutorialUrlInput ? elements.tutorialUrlInput.value.trim() : "",
    enable_incognito_restart: elements.enableIncognitoRestartInput ? elements.enableIncognitoRestartInput.checked : false,
    client_can_inject: elements.clientCanInjectInput ? elements.clientCanInjectInput.checked : false,
    clear_cache_button: elements.clearCacheButtonInput ? elements.clearCacheButtonInput.checked : false,
    fingerprint_config: (() => {
      const fp = getProfileData() || {};
      fp.streaming_drm_clean = Boolean(elements.streamingDrmCleanInput?.checked);
      fp.lovable_compat = Boolean(elements.lovableCompatInput?.checked);
      fp.chromium_lite = Boolean(elements.chromiumLiteInput?.checked);
      return fp;
    })(),
    profile_group_ids: getSelectedValues(elements.cardProfileGroupsSelect)
  };

  const streamingOn = Boolean(elements.streamingDrmCleanInput?.checked);
  const lovableCompatOn = Boolean(elements.lovableCompatInput?.checked);
  const chromiumLiteOn = Boolean(elements.chromiumLiteInput?.checked);
  let savedCardId = state.editingCardId;

  if (state.editingCardId) {
    await api(`/api/owner/cards/${state.editingCardId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  } else {
    const created = await api("/api/owner/cards", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    savedCardId = created?.id || created?.card?.id || state.editingCardId;
  }

  // Cache local del botón (API dashboard a veces no devolvía fingerprint_config)
  if (savedCardId) {
    try {
      const mapKey = "iamax_streaming_drm_cards";
      const map = JSON.parse(localStorage.getItem(mapKey) || "{}");
      if (streamingOn) map[String(savedCardId)] = true;
      else delete map[String(savedCardId)];
      localStorage.setItem(mapKey, JSON.stringify(map));
    } catch { /* ignore */ }
    try {
      const mapKey = "iamax_lovable_compat_cards";
      const map = JSON.parse(localStorage.getItem(mapKey) || "{}");
      if (lovableCompatOn) map[String(savedCardId)] = true;
      else delete map[String(savedCardId)];
      localStorage.setItem(mapKey, JSON.stringify(map));
    } catch { /* ignore */ }
    try {
      const mapKey = "iamax_chromium_lite_cards";
      const map = JSON.parse(localStorage.getItem(mapKey) || "{}");
      if (chromiumLiteOn) map[String(savedCardId)] = true;
      else delete map[String(savedCardId)];
      localStorage.setItem(mapKey, JSON.stringify(map));
    } catch { /* ignore */ }
    try {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: "SET_STREAMING_DRM_FLAG",
            cardId: savedCardId,
            enabled: streamingOn
          },
          resolve
        );
      });
      console.log(
        "[Owner] Flag streaming local card=",
        savedCardId,
        streamingOn,
        "lovableCompat=",
        lovableCompatOn,
        "chromiumLite=",
        chromiumLiteOn
      );
    } catch (e) {
      console.warn("[Owner] SET_STREAMING_DRM_FLAG:", e);
    }
  }

  resetCardForm();
  await loadAll();
});

function handleFileSelect(fileInput, stateKey, previewElement) {
  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Validar tamaño máximo
    if (file.size > 5 * 1024 * 1024) {
      alert("El archivo es muy grande. Intenta subir una imagen de menos de 5MB.");
      fileInput.value = "";
      return;
    }

    const label = fileInput.closest(".upload-field")?.querySelector("label");
    const originalText = label ? label.textContent : "";
    if (label) label.textContent = "⏳ Subiendo a la nube...";

    try {
      const fd = new FormData();
      fd.append("image", file);

      const res = await fetch("https://api.imgur.com/3/image", {
        method: "POST",
        headers: { Authorization: "Client-ID 546c25a59c58ad7" },
        body: fd
      });
      const data = await res.json();

      if (data.success) {
        state[stateKey] = data.data.link;
        updateImagePreview(previewElement, state[stateKey]);
      } else {
        alert("Error al subir la imagen a la nube: " + (data.data?.error || "Desconocido"));
        fileInput.value = "";
      }
    } catch (err) {
      console.error(err);
      alert("Error de conexión al intentar subir la imagen a la nube.");
      fileInput.value = "";
    } finally {
      if (label) label.textContent = originalText;
    }
  });
}

handleFileSelect(elements.logoFileInput, "currentLogo", elements.logoPreview);
elements.clearLogoBtn.addEventListener("click", () => {
  state.currentLogo = "";
  elements.logoFileInput.value = "";
  updateImagePreview(elements.logoPreview, "");
});

handleFileSelect(elements.backgroundFileInput, "currentBackground", elements.backgroundPreview);
elements.clearBackgroundBtn.addEventListener("click", () => {
  state.currentBackground = "";
  elements.backgroundFileInput.value = "";
  updateImagePreview(elements.backgroundPreview, "");
});

handleFileSelect(elements.cardLogoFileInput, "currentCardLogo", elements.cardLogoPreview);
elements.clearCardLogoBtn.addEventListener("click", () => {
  state.currentCardLogo = "";
  elements.cardLogoFileInput.value = "";
  updateImagePreview(elements.cardLogoPreview, "");
});

handleFileSelect(elements.bannerFileInput, "currentBanner", elements.bannerPreview);
elements.clearBannerBtn.addEventListener("click", () => {
  state.currentBanner = "";
  elements.bannerFileInput.value = "";
  updateImagePreview(elements.bannerPreview, "");
});

// loadAll() was moved to the bottom of the file

if (elements.profileGroupForm) {
  elements.profileGroupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      name: elements.profileGroupNameInput.value.trim(),
      description: elements.profileGroupDescriptionInput.value.trim()
    };

    if (!payload.name) {
      alert("Nombre de grupo requerido.");
      return;
    }

    if (state.editingProfileGroupId) {
      await api(`/api/owner/profile-groups/${state.editingProfileGroupId}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
    } else {
      await api("/api/owner/profile-groups", {
        method: "POST",
        body: JSON.stringify(payload)
      });
    }

    resetProfileGroupForm();
    await loadAll();
    await loadClients();
    activateTeamTab("grupos");
  });

  elements.cancelProfileGroupBtn?.addEventListener("click", resetProfileGroupForm);
}

// Clients Logic
/* Legacy block disabled: it was truncated by a previous desktop patch.
function renderClients(clients) {
    console.log("Renderizando clientes:", clients);
    
    const counter = document.getElementById("totalClientsCounter");
    if (counter) counter.textContent = clients.length;
  
    const tbody = document.getElementById("clientsTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";
    
    clients.forEach(client => {
      const tr = document.createElement("tr");
      const lastLogin = client.last_login ? new Date(client.last_login).toLocaleDateString() : "Nunca";
      const expires = client.expires_at ? new Date(client.expires_at).toLocaleDateString() : "Ilimitado";
      
      const planHtml = client.plan === 'ultra' ? '<span style="color:var(--accent); font-weight:bold;">Ultra</span>' : 'Estándar';
      const statusHtml = client.status === 'active' ? '<span style="color:var(--accent);">Activo</span>' : '<span style="color:red;">Suspendido</span>';

      tr.innerHTML = `
        <td><input type="checkbox"></td>
        <td>${escapeHtml(client.email)}</td>
        <td>${planHtml}</td>
        <td>${escapeHtml(profileGroupLabel(client))}</td>
        <td>${statusHtml}</td>
        <td>${expires}</td>
        <td>${lastLogin}</td>
        <td>
          <button class="dic-btn-dark edit-client-btn" type="button" data-id="${client.id}" style="font-size:11px; padding:4px 8px;">Editar</button>
          <button class="dic-btn-dark reset-client-btn" type="button" data-id="${client.id}" style="font-size:11px; padding:4px 8px; margin-left:4px;">Reset</button>
          <button class="dic-icon-btn del-client-btn" type="button" data-id="${client.id}" style="color:red; margin-left:4px;" title="Borrar">🗑️</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
}

        this.proxies.push({
          id: Date.now().toString(),
          name, host, port, user, pass,
          createdAt: new Date().toISOString()
        });

        this.saveProxies();
        closeModal();
      });
    });

    const tbodys = document.querySelectorAll('#proxyTableBody');
    tbodys.forEach(tbody => {
      tbody.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-proxy-btn')) {
          const id = e.target.getAttribute('data-id');
          if (confirm('¿Eliminar este proxy?')) {
            this.proxies = this.proxies.filter(p => p.id !== id);
            this.saveProxies();
          }
        }
      });
    });

    document.getElementById('checkAllProxies')?.addEventListener('change', (event) => {
      document.querySelectorAll('#proxyTableBody input[type=checkbox]')
        .forEach(checkbox => { checkbox.checked = event.target.checked; });
    });
  },
  renderTable() {
    const tbody = document.getElementById('proxyTableBody');
    const totalEl = document.getElementById('proxyTotal');
    if (!tbody) return;

    tbody.innerHTML = '';
    this.proxies.forEach((p, index) => {
      const tr = document.createElement('tr');
      const date = new Date(p.createdAt).toLocaleDateString();
      tr.innerHTML = `
        <td><input type="checkbox"></td>
        <td>${index + 1}</td>
        <td>${p.host}:${p.port}</td>
        <td>${p.name}</td>
        <td>
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="font-size:16px;">🇺🇸</span> US-United States<br>
            <span style="color:var(--accent); font-size:11px;">Exitoso</span>
          </div>
        </td>
        <td>-</td>
        <td>${date}</td>
        <td>
          <button class="dic-icon-btn delete-proxy-btn" data-id="${p.id}" style="color:red;" title="Eliminar">🗑️</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    if (totalEl) totalEl.textContent = this.proxies.length;
  },
  populateSelect() {
    const select = document.getElementById('savedProxySelect');
    if (!select) return;
    select.innerHTML = '<option value="">-- Seleccionar Proxy --</option>';
    this.proxies.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      let label = `${p.name} (${p.host}:${p.port})`;
      if (p.user) label += ` - ${p.user}`;
      opt.textContent = label;
      select.appendChild(opt);
    });
  },
  getProxy(id) {
    return this.proxies.find(p => p.id === id);
  }
};

window.ProxyManager = ProxyManager;
*/

function formatClientDate(value, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? fallback
    : date.toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function getClientDisplayName(client) {
  const email = String(client?.email || "").trim();
  if (!email) return "Sin nombre";
  const local = email.split("@")[0] || email;
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase()) || email;
}

function getClientInitial(client) {
  const name = getClientDisplayName(client);
  const letter = (name.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]/) || ["?"])[0];
  return letter.toUpperCase();
}

function getClientAvatarClass(client) {
  const seed = String(client?.id || client?.email || "0");
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0;
  }
  return `c${Math.abs(hash) % 8}`;
}

function getClientStatusInfo(client) {
  const expiresAt = client?.expires_at ? new Date(client.expires_at) : null;
  const isExpired = expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < Date.now();
  if (isExpired) {
    return { className: "vencido", label: "Vencido" };
  }
  if (client?.status === "active") {
    return { className: "vigente", label: "Vigente" };
  }
  return { className: "suspendido", label: "Suspendido" };
}

function getVisibleClients() {
  const term = state.clientSearch.trim().toLowerCase();
  const group = state.clientGroupFilter;
  const status = state.clientStatusFilter;

  return state.clients.filter((client) => {
    const displayName = getClientDisplayName(client).toLowerCase();
    const phone = String(client.phone || "").toLowerCase();
    const matchesTerm = !term
      || String(client.email || "").toLowerCase().includes(term)
      || displayName.includes(term)
      || phone.includes(term)
      || String(client.id || "").toLowerCase().includes(term);
    const clientGroup = client.profile_group_id == null ? "none" : String(client.profile_group_id);
    const matchesGroup = group === "all" || clientGroup === group;

    let matchesStatus = true;
    if (status !== "all") {
      const info = getClientStatusInfo(client).className;
      if (status === "vigente") {
        matchesStatus = info === "vigente";
      } else if (status === "inactivo") {
        matchesStatus = info !== "vigente";
      }
    }

    return matchesTerm && matchesGroup && matchesStatus;
  });
}

function clientActionIcon(action) {
  if (action === "edit") {
    return '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 0L8 18l-4 1 1-4Z"></path></svg>';
  }
  if (action === "reset") {
    return '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 11a8 8 0 1 0-2.3 5.7"></path><path d="M20 4v7h-7"></path></svg>';
  }
  return '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="m19 6-1 14H6L5 6"></path><path d="M10 11v5M14 11v5"></path></svg>';
}

function renderClients() {
  const listEl = elements.clientsList;
  if (!listEl && !elements.clientsTableBody) return;

  const total = state.clients.length;
  let vigentes = 0;
  for (const client of state.clients) {
    if (getClientStatusInfo(client).className === "vigente") vigentes += 1;
  }
  if (elements.totalClientsCounter) elements.totalClientsCounter.textContent = total;
  if (elements.activeClientsCounter) elements.activeClientsCounter.textContent = vigentes;
  if (elements.inactiveClientsCounter) elements.inactiveClientsCounter.textContent = Math.max(0, total - vigentes);

  const filtered = getVisibleClients();
  const totalPages = Math.max(1, Math.ceil(filtered.length / state.clientPageSize));
  state.clientPage = Math.min(Math.max(state.clientPage, 1), totalPages);
  const start = (state.clientPage - 1) * state.clientPageSize;
  const pageClients = filtered.slice(start, start + state.clientPageSize);

  if (!pageClients.length) {
    const message = state.clients.length
      ? "No hay clientes que coincidan con los filtros."
      : "Todavía no hay clientes registrados.";
    if (listEl) {
      listEl.innerHTML = `<div class="clients-ui-empty">${message}</div>`;
    }
  } else if (listEl) {
    listEl.innerHTML = pageClients.map((client) => {
      const status = getClientStatusInfo(client);
      const planLabel = client.plan === "ultra" ? "Ultra" : "Estándar";
      const displayName = getClientDisplayName(client);
      const email = client.email || "Sin correo";
      const phone = String(client.phone || "").trim();
      const expiresLabel = formatClientDate(client.expires_at, "Sin límite");
      const phoneDisplay = phone || "Sin número";
      const planLine = `${planLabel} · Expira ${expiresLabel}`;

      return `
        <article class="clients-ui-card" role="listitem" data-client-id="${client.id}" tabindex="0" aria-label="Cliente ${escapeHtml(displayName)}">
          <div class="clients-ui-avatar ${getClientAvatarClass(client)}" aria-hidden="true">${escapeHtml(getClientInitial(client))}</div>
          <div class="clients-ui-info">
            <h3 class="clients-ui-name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</h3>
            <p class="clients-ui-email" title="${escapeHtml(email)}">${escapeHtml(email)}</p>
            <div class="clients-ui-phone-line">
              <span class="clients-ui-phone-label">Teléfono</span>
              <span class="clients-ui-phone-value ${phone ? "" : "is-empty"}" title="${escapeHtml(phoneDisplay)}">${escapeHtml(phoneDisplay)}</span>
            </div>
            <div class="clients-ui-phone-line clients-ui-plan-line">
              <span class="clients-ui-phone-label">Plan</span>
              <span class="clients-ui-phone-value" title="${escapeHtml(planLine)}">${escapeHtml(planLine)}</span>
            </div>
          </div>
          <div class="clients-ui-side">
            <span class="clients-ui-status ${status.className}">${status.label}</span>
            <div class="clients-ui-actions">
              <button class="clients-ui-action" type="button" data-client-action="edit" data-id="${client.id}" aria-label="Editar cliente" title="Editar">${clientActionIcon("edit")}</button>
              <button class="clients-ui-action" type="button" data-client-action="reset" data-id="${client.id}" aria-label="Reiniciar dispositivos" title="Reiniciar dispositivos">${clientActionIcon("reset")}</button>
              <button class="clients-ui-action danger" type="button" data-client-action="delete" data-id="${client.id}" aria-label="Borrar cliente" title="Borrar">${clientActionIcon("delete")}</button>
            </div>
          </div>
        </article>
      `;
    }).join("");
  }

  if (elements.clientsResultSummary) {
    const first = filtered.length ? start + 1 : 0;
    const last = Math.min(start + state.clientPageSize, filtered.length);
    elements.clientsResultSummary.textContent = filtered.length
      ? `${first}-${last} de ${filtered.length} resultados`
      : "0 resultados";
  }
  if (elements.clientsPageIndicator) {
    elements.clientsPageIndicator.textContent = `${state.clientPage} / ${totalPages}`;
  }
  if (elements.clientsPrevPage) elements.clientsPrevPage.disabled = state.clientPage <= 1;
  if (elements.clientsNextPage) elements.clientsNextPage.disabled = state.clientPage >= totalPages;
}

function resetClientForm() {
  elements.clientForm?.reset();
  if (elements.clientIdInput) elements.clientIdInput.value = "";
  if (elements.clientPhoneInput) elements.clientPhoneInput.value = "";
  if (elements.clientPlanSelect) elements.clientPlanSelect.value = "standard";
  if (elements.clientProfileGroupSelect) elements.clientProfileGroupSelect.value = "";
  if (elements.clientStatusSelect) elements.clientStatusSelect.value = "active";
  if (elements.clientModalTitle) elements.clientModalTitle.textContent = "Crear cliente";
  if (elements.saveClientBtn) elements.saveClientBtn.textContent = "Crear cliente";
}

function openClientModal(client = null) {
  resetClientForm();
  if (client) {
    elements.clientIdInput.value = client.id;
    elements.clientEmailInput.value = client.email || "";
    if (elements.clientPhoneInput) elements.clientPhoneInput.value = client.phone || "";
    elements.clientPasswordInput.value = "";
    elements.clientPlanSelect.value = client.plan || "standard";
    elements.clientProfileGroupSelect.value = client.profile_group_id == null ? "" : String(client.profile_group_id);
    elements.clientStatusSelect.value = client.status || "active";
    elements.clientExpiresInput.value = client.expires_at ? String(client.expires_at).slice(0, 10) : "";
    elements.clientModalTitle.textContent = "Editar cliente";
    elements.saveClientBtn.textContent = "Guardar cambios";
  }

  elements.clientModal?.classList.add("open");
  elements.clientModal?.setAttribute("aria-hidden", "false");
  setTimeout(() => elements.clientEmailInput?.focus(), 50);
}

function closeClientModal() {
  elements.clientModal?.classList.remove("open");
  elements.clientModal?.setAttribute("aria-hidden", "true");
  resetClientForm();
}

async function loadClients() {
  if (elements.clientsList) {
    elements.clientsList.innerHTML = '<div class="clients-ui-empty">Cargando clientes...</div>';
  }
  try {
    state.clients = await api("/api/owner/clients");
    renderClients();
  } catch (error) {
    if (elements.clientsList) {
      elements.clientsList.innerHTML = `<div class="clients-ui-empty">No se pudieron cargar los clientes: ${escapeHtml(error.message)}</div>`;
    }
  }
}

elements.addClientBtn?.addEventListener("click", () => openClientModal());
elements.clientModalClose?.addEventListener("click", closeClientModal);
elements.clientModalCancel?.addEventListener("click", closeClientModal);
elements.clientModal?.addEventListener("click", (event) => {
  if (event.target === elements.clientModal) closeClientModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && elements.clientModal?.classList.contains("open")) {
    closeClientModal();
  }
});

elements.clientSearchInput?.addEventListener("input", (event) => {
  state.clientSearch = event.target.value || "";
  state.clientPage = 1;
  renderClients();
});

elements.clientGroupFilter?.addEventListener("change", (event) => {
  state.clientGroupFilter = event.target.value || "all";
  state.clientPage = 1;
  renderClients();
});

elements.clientStatusFilter?.addEventListener("change", (event) => {
  state.clientStatusFilter = event.target.value || "all";
  state.clientPage = 1;
  renderClients();
});

elements.clientsPrevPage?.addEventListener("click", () => {
  if (state.clientPage <= 1) return;
  state.clientPage -= 1;
  renderClients();
});

elements.clientsNextPage?.addEventListener("click", () => {
  const totalPages = Math.max(1, Math.ceil(getVisibleClients().length / state.clientPageSize));
  if (state.clientPage >= totalPages) return;
  state.clientPage += 1;
  renderClients();
});

async function handleClientListAction(event) {
  const button = event.target.closest("[data-client-action]");
  if (button) {
    const client = state.clients.find((item) => String(item.id) === button.dataset.id);
    if (!client) return;

    const action = button.dataset.clientAction;
    if (action === "edit") {
      openClientModal(client);
      return;
    }

    if (action === "reset") {
      if (!confirm(`Reiniciar los dispositivos de ${client.email}? Tendrá que iniciar sesión nuevamente.`)) return;
      try {
        const result = await api(`/api/owner/clients/${client.id}/reset-devices`, { method: "POST" });
        alert(result.message || "Dispositivos reiniciados.");
      } catch (error) {
        alert("Error: " + error.message);
      }
      return;
    }

    if (!confirm(`Borrar a ${client.email}? Perderá el acceso inmediatamente.`)) return;
    try {
      await api(`/api/owner/clients/${client.id}`, { method: "DELETE" });
      await loadClients();
    } catch (error) {
      alert("Error: " + error.message);
    }
    return;
  }

  // Tap en la tarjeta (sin botones) → editar
  const card = event.target.closest(".clients-ui-card[data-client-id]");
  if (!card || event.target.closest("button")) return;
  const client = state.clients.find((item) => String(item.id) === card.dataset.clientId);
  if (client) openClientModal(client);
}

elements.clientsList?.addEventListener("click", handleClientListAction);
elements.clientsList?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const card = event.target.closest(".clients-ui-card[data-client-id]");
  if (!card) return;
  event.preventDefault();
  const client = state.clients.find((item) => String(item.id) === card.dataset.clientId);
  if (client) openClientModal(client);
});
elements.clientsTableBody?.addEventListener("click", handleClientListAction);

elements.generatePasswordBtn?.addEventListener("click", () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const values = new Uint32Array(14);
  window.crypto.getRandomValues(values);
  elements.clientPasswordInput.value = [...values].map((value) => chars[value % chars.length]).join("");
  elements.clientPasswordInput.focus();
});

elements.clientForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = elements.clientIdInput.value;
  const payload = {
    email: elements.clientEmailInput.value.trim(),
    phone: (elements.clientPhoneInput?.value || "").trim(),
    password: elements.clientPasswordInput.value,
    plan: elements.clientPlanSelect.value,
    profile_group_id: elements.clientProfileGroupSelect.value
      ? Number(elements.clientProfileGroupSelect.value)
      : null,
    status: elements.clientStatusSelect.value,
    expires_at: elements.clientExpiresInput.value || null
  };

  if (!id && !payload.password) {
    alert("La contraseña es obligatoria para crear un cliente.");
    elements.clientPasswordInput.focus();
    return;
  }

  const originalText = elements.saveClientBtn.textContent;
  elements.saveClientBtn.disabled = true;
  elements.saveClientBtn.textContent = "Guardando...";
  try {
    await api(id ? `/api/owner/clients/${id}` : "/api/owner/clients", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });
    closeClientModal();
    await loadClients();
  } catch (error) {
    alert("Error: " + error.message);
  } finally {
    elements.saveClientBtn.disabled = false;
    elements.saveClientBtn.textContent = originalText;
  }
});

let authLocalTimer = null;
let currentAuthRemaining = 0;

function populateAuthCardSelect() {
  if (!elements.authCardSelect) return;
  const previousValue = elements.authCardSelect.value;
  elements.authCardSelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = state.cards.length ? "Selecciona una tarjeta" : "No hay tarjetas disponibles";
  elements.authCardSelect.appendChild(placeholder);
  state.cards.forEach((card) => {
    const option = document.createElement("option");
    option.value = String(card.id);
    option.textContent = card.name || `Tarjeta ${card.id}`;
    elements.authCardSelect.appendChild(option);
  });
  if (state.cards.some((card) => String(card.id) === previousValue)) {
    elements.authCardSelect.value = previousValue;
  }
}

async function fetchAndRenderAuth() {
  if (!elements.authList) return;
  try {
    const data = await api("/api/public/2fa");
    currentAuthRemaining = Number(data.remaining || 0);
    const codes = Array.isArray(data.codes) ? data.codes : [];
    elements.authList.innerHTML = codes.length ? codes.map((card) => {
      const totpCode = formatTotpCode(card.code);
      const hasCode = totpCode !== "------";
      const isEmail = card.code_source === "email" || card.code_source === "email_waiting";
      const displayCode = hasCode ? escapeHtml(totpCode) : (isEmail ? "Esperando código del correo" : "Sin código");
      return `
      <div class="auth-item" style="display:grid;gap:8px;background:rgba(255,255,255,.05);padding:12px;border-radius:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <strong>${escapeHtml(card.name || "Perfil")}</strong>
          <span class="owner-code-source-badge">${isEmail ? "GMAIL" : "AUTHENTICATOR"}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <span class="auth-item-code" style="font-size:${hasCode ? "1.6rem" : "0.95rem"};font-weight:800;color:var(--accent);">${displayCode}</span>
          ${hasCode ? `<button type="button" class="auth-copy-code kaizen-btn ghost" data-copy-code="${escapeHtml(totpCode.replace(/\s+/g, ""))}">Copiar</button>` : ""}
        </div>
        ${isEmail ? `<small class="muted">Fuente: ${escapeHtml(card.login_email || "Gmail configurado")}. Solo se comparte el código.</small>` : ""}
      </div>
    `;
    }).join("") : '<p class="muted" style="text-align:center;">No hay códigos disponibles. Selecciona una tarjeta arriba para configurar Gmail o Authenticator.</p>';
    elements.authList.querySelectorAll(".auth-copy-code").forEach((button) => {
      button.addEventListener("click", async () => {
        const value = button.dataset.copyCode || "";
        if (value) await navigator.clipboard.writeText(value);
      });
    });
  } catch {
    elements.authList.innerHTML = '<p class="muted" style="text-align:center;color:coral;">Error al cargar 2FA.</p>';
  }
}

function stopAuthTimers() {
  if (authLocalTimer) clearInterval(authLocalTimer);
  authLocalTimer = null;
}

function startAuthTimers() {
  stopAuthTimers();
  fetchAndRenderAuth();
  authLocalTimer = setInterval(() => {
    currentAuthRemaining -= 1;
    if (currentAuthRemaining <= 0) fetchAndRenderAuth();
  }, 1000);
}

elements.openAuthButton?.addEventListener("click", () => {
  populateAuthCardSelect();
  elements.authDialog?.showModal();
  startAuthTimers();
});
elements.configureAuthCardButton?.addEventListener("click", () => {
  const selectedId = String(elements.authCardSelect?.value || "");
  const card = state.cards.find((item) => String(item.id) === selectedId);
  if (!card) {
    elements.authCardSelect?.focus();
    return;
  }
  elements.authDialog?.close();
  stopAuthTimers();
  fillCardForm(card);
});
elements.closeAuthButton?.addEventListener("click", () => {
  elements.authDialog?.close();
  stopAuthTimers();
});

elements.logoutButton?.addEventListener("click", async () => {
  try {
    elements.logoutButton.disabled = true;
    await logoutSession();
  } catch (error) {
    console.warn("[Logout] Error al cerrar sesion (owner):", error);
    await clearLocalAuthSession();
  } finally {
    window.location.href = "index.html";
  }
});

function renderTutorials() {
  if (!elements.tutorialsTableBody) return;
  if (!state.tutorials.length) {
    elements.tutorialsTableBody.innerHTML = '<tr><td colspan="4" class="muted" style="text-align:center;">No hay tutoriales registrados</td></tr>';
    return;
  }

  elements.tutorialsTableBody.innerHTML = state.tutorials.map((tutorial) => `
    <tr>
      <td>${escapeHtml(tutorial.sort_order)}</td>
      <td><strong>${escapeHtml(tutorial.title)}</strong><br><span class="muted">${escapeHtml(tutorial.description || "")}</span></td>
      <td>${isSafeHttpUrl(tutorial.video_url) ? `<a href="${escapeHtml(tutorial.video_url)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent-blue);">${escapeHtml(tutorial.video_url)}</a>` : `<span class="muted">${escapeHtml(String(tutorial.video_url || "URL invalida"))}</span>`}</td>
      <td><button class="kaizen-btn danger del-tut-btn" type="button" data-id="${tutorial.id}">Borrar</button></td>
    </tr>
  `).join("");
}

elements.tutorialsTableBody?.addEventListener("click", async (event) => {
  const button = event.target.closest(".del-tut-btn");
  if (!button || !confirm("¿Eliminar este tutorial?")) return;
  try {
    await api(`/api/owner/tutorials/${button.dataset.id}`, { method: "DELETE" });
    await loadAll();
  } catch (error) {
    alert("Error: " + error.message);
  }
});

elements.tutorialForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/owner/tutorials", {
      method: "POST",
      body: JSON.stringify({
        title: elements.tutorialTitle.value,
        video_url: elements.tutorialUrl.value,
        description: elements.tutorialDesc.value,
        sort_order: elements.tutorialOrder.value
      })
    });
    elements.tutorialForm.reset();
    await loadAll();
  } catch (error) {
    alert("Error: " + error.message);
  }
});

if (token) {
  initProfileEditor();
  initTeamManager();
  loadAll()
    .then(() => activateOwnerView(location.hash || "#statsGrid"))
    .catch((error) => {
      console.error(error);
      alert("Error al cargar panel: " + error.message);
    });
}

const ProxyManager = {
  proxies: [],
  listenersReady: false,
  init() {
    this.loadProxies();
    this.setupListeners();
    this.renderTable();
    this.populateSelect();
  },
  loadProxies() {
    try {
      this.proxies = JSON.parse(localStorage.getItem("iamax_saved_proxies") || "[]");
    } catch {
      this.proxies = [];
    }
  },
  saveProxies() {
    localStorage.setItem("iamax_saved_proxies", JSON.stringify(this.proxies));
    this.renderTable();
    this.populateSelect();
  },
  setupListeners() {
    if (this.listenersReady) return;
    this.listenersReady = true;
    const modal = document.getElementById("proxyModal");
    const close = () => modal?.classList.remove("open");

    document.getElementById("btnCrearProxy")?.addEventListener("click", () => {
      ["pmName", "pmHost", "pmPort", "pmUser", "pmPass"].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.value = "";
      });
      const typeSel = document.getElementById("pmType");
      if (typeSel) typeSel.value = "socks5";
      modal?.classList.add("open");
    });
    document.getElementById("proxyModalCancel")?.addEventListener("click", close);
    document.getElementById("proxyModalClose")?.addEventListener("click", close);
    modal?.addEventListener("click", (event) => {
      if (event.target === modal) close();
    });
    document.getElementById("proxyModalConfirm")?.addEventListener("click", () => {
      const read = (id) => document.getElementById(id)?.value.trim() || "";
      const type = (document.getElementById("pmType")?.value || "socks5").toLowerCase();
      const proxy = {
        id: Date.now().toString(),
        name: read("pmName"),
        host: read("pmHost").replace(/^(socks5h?|socks4a?|socks|http|https):\/\//i, ""),
        port: read("pmPort"),
        user: read("pmUser"),
        pass: read("pmPass"),
        type,
        protocol: type,
        createdAt: new Date().toISOString()
      };
      if (!proxy.name || !proxy.host || !proxy.port) {
        alert("Nombre, Host y Puerto son obligatorios.");
        return;
      }
      this.proxies.push(proxy);
      this.saveProxies();
      close();
    });
    document.getElementById("proxyTableBody")?.addEventListener("click", async (event) => {
      const testBtn = event.target.closest(".test-proxy-btn");
      if (testBtn) {
        const proxy = this.getProxy(testBtn.dataset.id);
        if (!proxy) return;
        const prev = testBtn.textContent;
        const pType = String(proxy.type || proxy.protocol || "socks5").toLowerCase();
        testBtn.disabled = true;
        testBtn.textContent = "Verificando…";
        try {
          const result = await api("/api/owner/test-proxy", {
            method: "POST",
            body: JSON.stringify({
              host: proxy.host,
              port: proxy.port,
              username: proxy.user || proxy.username || "",
              password: proxy.pass || proxy.password || "",
              protocol: pType,
              proxy_type: pType
            })
          });
          if (result.working && result.ip) {
            proxy.lastIp = result.ip;
            proxy.lastLatency = result.latency;
            proxy.lastCountry = result.country || "";
            proxy.lastCountryCode = result.countryCode || "";
            proxy.lastCity = result.city || "";
            proxy.lastCountryLabel = result.countryLabel || "";
            proxy.lastCheckedAt = new Date().toISOString();
            this.saveProxies();
            const geo = result.countryCode || result.country || "";
            testBtn.textContent = geo ? `✅ ${geo}` : `✅ ${result.ip}`;
            testBtn.style.color = "#22c55e";
            showProxyTestResult({
              ok: true,
              ip: result.ip,
              latency: result.latency,
              protocol: pType,
              host: proxy.host,
              port: proxy.port,
              name: proxy.name || "",
              country: result.country || "",
              countryCode: result.countryCode || "",
              city: result.city || "",
              countryLabel: result.countryLabel || ""
            });
          } else {
            testBtn.textContent = "❌ Falló";
            testBtn.style.color = "#ef4444";
            showProxyTestResult({
              ok: false,
              protocol: pType,
              host: proxy.host,
              port: proxy.port,
              name: proxy.name || "",
              error: result.error || "Sin detalle"
            });
          }
        } catch (error) {
          testBtn.textContent = "❌ Error";
          testBtn.style.color = "#ef4444";
          showProxyTestResult({
            ok: false,
            protocol: pType,
            host: proxy.host,
            port: proxy.port,
            name: proxy.name || "",
            error: error.message || String(error)
          });
        }
        setTimeout(() => {
          testBtn.textContent = prev || "Testear IP";
          testBtn.style.color = "";
          testBtn.disabled = false;
        }, 5000);
        return;
      }

      const button = event.target.closest(".delete-proxy-btn");
      if (!button || !confirm("¿Eliminar este proxy?")) return;
      this.proxies = this.proxies.filter((proxy) => proxy.id !== button.dataset.id);
      this.saveProxies();
    });
  },
  renderTable() {
    const tbody = document.getElementById("proxyTableBody");
    if (!tbody) return;
    if (!this.proxies.length) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="own-empty" style="min-height:100px;padding:20px;text-align:center;color:var(--muted);">No hay proxies. Usa “+ Crear proxy”.</div></td></tr>`;
    } else {
      tbody.innerHTML = this.proxies.map((proxy, index) => {
        const pType = String(proxy.type || proxy.protocol || "http").toUpperCase();
        const lastIp = proxy.lastIp ? escapeHtml(proxy.lastIp) : "";
        const geoLine = escapeHtml(
          proxy.lastCountryLabel
          || [proxy.lastCity, proxy.lastCountry].filter(Boolean).join(", ")
          || proxy.lastCountryCode
          || ""
        );
        const lat = proxy.lastLatency != null
          ? `<span class="proxy-latency-pill">${escapeHtml(String(proxy.lastLatency))} ms</span>`
          : "";
        const ipCell = lastIp
          ? `<span class="proxy-exit-ip" title="IP de salida + país">
              <span>${lastIp}</span>
              ${geoLine ? `<span class="proxy-country-line">${geoLine}</span>` : ""}
              ${lat}
            </span>`
          : `<span class="proxy-exit-ip is-empty">Sin verificar</span>`;
        return `
        <tr class="own-row">
          <td><input type="checkbox" aria-label="Seleccionar proxy"></td>
          <td><span class="own-index" style="display:inline-grid;place-items:center;min-width:28px;height:28px;border-radius:8px;background:rgba(45,212,191,.1);color:#5eead4;font-weight:800;">${index + 1}</span></td>
          <td>
            <strong style="font-family:ui-monospace,monospace;font-size:12px;">${escapeHtml(pType)}://${escapeHtml(proxy.host)}:${escapeHtml(proxy.port)}</strong>
            <div style="font-size:11px;color:var(--muted);margin-top:2px;">${escapeHtml(proxy.name)}</div>
          </td>
          <td style="color:var(--muted);">—</td>
          <td>${ipCell}</td>
          <td style="color:var(--muted);">—</td>
          <td style="color:var(--muted);font-size:12px;">${formatClientDate(proxy.createdAt, "--")}</td>
          <td style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="dic-btn-dark test-proxy-btn" type="button" data-id="${proxy.id}" title="Verificar IP de salida">Testear IP</button>
            <button class="dic-btn-dark delete-proxy-btn" type="button" data-id="${proxy.id}" title="Eliminar" style="color:#fecdd3;border-color:rgba(251,113,133,.35);">Borrar</button>
          </td>
        </tr>`;
      }).join("");
    }
    const total = document.getElementById("proxyTotal");
    if (total) total.textContent = this.proxies.length;
  },
  populateSelect() {
    const select = document.getElementById("savedProxySelect");
    if (!select) return;
    select.innerHTML = '<option value="">-- Seleccionar Proxy --</option>';
    this.proxies.forEach((proxy) => {
      const option = document.createElement("option");
      const pType = String(proxy.type || proxy.protocol || "http").toUpperCase();
      option.value = proxy.id;
      option.textContent = `${proxy.name} [${pType}] (${proxy.host}:${proxy.port})${proxy.user ? ` - ${proxy.user}` : ""}`;
      select.appendChild(option);
    });
  },
  getProxy(id) {
    return this.proxies.find((proxy) => proxy.id === id);
  }
};

window.ProxyManager = ProxyManager;


// ==========================================
// ExtensionManager (LocalStorage)
// ==========================================
const ExtensionManager = {
  extensions: [],
  listenersReady: false,
  currentMethod: 'store',
  init() {
    this.loadExtensions();
    this.setupListeners();
    this.renderGrid();
  },
  loadExtensions() {
    try {
      const data = localStorage.getItem('iamax_saved_extensions');
      if (data) {
        this.extensions = JSON.parse(data);
      } else {
        this.extensions = [];
      }
    } catch (e) {
      this.extensions = [];
    }
  },
  saveExtensions() {
    localStorage.setItem('iamax_saved_extensions', JSON.stringify(this.extensions));
    this.renderGrid();
  },
  setupListeners() {
    if (this.listenersReady) return;
    this.listenersReady = true;

    const btnCrears = document.querySelectorAll('#btnCrearExtension');
    const modals = document.querySelectorAll('#extModal');
    const btnCancels = document.querySelectorAll('#extModalCancel');
    const btnCloses = document.querySelectorAll('#extModalClose');
    const btnConfirms = document.querySelectorAll('#extModalConfirm');
    const methodButtons = document.querySelectorAll('.ext-method-btn');

    const setMethod = (method = 'store') => {
      this.currentMethod = method === 'package' ? 'package' : 'store';
      methodButtons.forEach((button) => {
        button.classList.toggle('active', button.dataset.method === this.currentMethod);
      });

      document.getElementById('extUriField')?.classList.toggle('hidden', this.currentMethod !== 'store');
      document.getElementById('extPackageField')?.classList.toggle('hidden', this.currentMethod !== 'package');
    };

    methodButtons.forEach((button) => {
      button.addEventListener('click', () => setMethod(button.dataset.method));
    });

    btnCrears.forEach(btn => {
      btn.addEventListener('click', () => {
        const uriEl = document.getElementById('extUri');
        const packageEl = document.getElementById('extPackage');
        const groupEl = document.getElementById('extGroupSelect');
        const pinEl = document.getElementById('extPin');

        if (uriEl) uriEl.value = '';
        if (packageEl) packageEl.value = '';
        if (groupEl) groupEl.selectedIndex = 0;
        if (pinEl) pinEl.selectedIndex = 0;
        setMethod('store');
        modals.forEach(m => m.classList.add('open'));
      });
    });

    const closeModal = () => { modals.forEach(m => m.classList.remove('open')); };
    btnCancels.forEach(btn => btn.addEventListener('click', closeModal));
    btnCloses.forEach(btn => btn.addEventListener('click', closeModal));
    modals.forEach(modal => {
      modal.addEventListener('click', (event) => {
        if (event.target === modal) closeModal();
      });
    });

    btnConfirms.forEach(btnConfirm => {
      btnConfirm.addEventListener('click', () => {
        const uriEl = document.getElementById('extUri');
        const packageEl = document.getElementById('extPackage');
        const groupEl = document.getElementById('extGroupSelect');
        const pinEl = document.getElementById('extPin');
        const group = groupEl ? groupEl.value : 'Sin agrupar';
        const pin = pinEl ? pinEl.value : 'Personalizado';
        const method = this.currentMethod === 'package' ? 'package' : 'store';
        let uri = uriEl ? uriEl.value.trim() : '';
        let methodLabel = 'Chrome Store';
        let packageName = '';

        let name = "Extensión Nueva";
        let version = "1.0.0";

        if (method === 'package') {
          const file = packageEl?.files?.[0];
          if (!file) {
            alert('Selecciona un paquete .zip o .crx.');
            return;
          }
          if (!/\.(zip|crx)$/i.test(file.name)) {
            alert('El paquete debe ser .zip o .crx.');
            return;
          }

          packageName = file.name;
          methodLabel = 'Subir paquete';
          uri = `package:${file.name}`;
          name = file.name.replace(/\.(zip|crx)$/i, '') || 'Paquete local';
        } else {
          if (!uri) {
            alert('URI de la extensión es obligatorio.');
            return;
          }

          const lowerUri = uri.toLowerCase();
          if (lowerUri.includes('bunny')) name = "Bunny";
          if (lowerUri.includes('vfo')) name = "VFO Automation";
          if (lowerUri.includes('stylebot')) name = "Stylebot";
        }

        const extId = Date.now().toString();

        this.extensions.push({
          id: extId,
          name, 
          version,
          group,
          pin,
          uri,
          packageName,
          active: true,
          method: methodLabel
        });

        this.saveExtensions();
        closeModal();
      });
    });

    const grids = document.querySelectorAll('#extensionGrid');
    grids.forEach(grid => {
      grid.addEventListener('change', (e) => {
        if (e.target.classList.contains('ext-toggle-switch')) {
          const id = e.target.getAttribute('data-id');
          const ext = this.extensions.find(x => x.id === id);
          if (ext) {
            ext.active = e.target.checked;
            localStorage.setItem('iamax_saved_extensions', JSON.stringify(this.extensions));
            this.renderGrid();
          }
        }
      });

      grid.addEventListener('click', (e) => {
        const switchLabel = e.target.closest?.('.ext-ui-switch');
        if (switchLabel && !e.target.classList.contains('ext-toggle-switch')) {
          const input = switchLabel.querySelector('.ext-toggle-switch');
          if (input) {
            input.checked = !input.checked;
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return;
        }

        const deleteButton = e.target.closest?.('.ext-delete-button');
        if (!deleteButton) return;

        const id = deleteButton.getAttribute('data-id');
        const ext = this.extensions.find(x => x.id === id);
        const label = ext?.name || 'esta extension';
        if (!confirm(`Eliminar "${label}" de extensiones?`)) return;

        this.extensions = this.extensions.filter(x => x.id !== id);
        this.saveExtensions();
      });
    });
  },
  renderGrid() {
    const grid = document.getElementById('extensionGrid');
    if (!grid) return;

    grid.classList.add('ext-ui-grid');
    if (!this.extensions.length) {
      grid.innerHTML = `
        <div class="ext-ui-empty">
          <div class="ext-ui-empty-icon" aria-hidden="true">🧩</div>
          <strong>No hay extensiones añadidas</strong>
          <p>Sube un paquete .zip/.crx o pega la URI de Chrome Store y asígnala a un grupo.</p>
        </div>`;
      return;
    }

    grid.innerHTML = this.extensions.map((ext) => {
      const safeId = escapeHtml(ext.id || '');
      const safeName = escapeHtml(ext.name || 'Extensión');
      const safeInitial = escapeHtml((ext.name || '?').charAt(0).toUpperCase());
      const safeVersion = escapeHtml(ext.version || '1.0.0');
      const safeGroup = escapeHtml(ext.group || 'Sin agrupar');
      const safeUri = escapeHtml(ext.uri || '');
      const safeMethod = escapeHtml(ext.method || 'Local');
      const isActive = ext.active !== false;
      return `
        <article class="ext-ui-card ${isActive ? '' : 'is-inactive'}" data-id="${safeId}">
          <header class="ext-ui-card-head">
            <div class="ext-ui-avatar"><span>${safeInitial}</span></div>
            <div class="ext-ui-card-title">
              <h3 title="${safeName}">${safeName}</h3>
              <div class="ext-ui-card-sub">
                <span class="ext-ui-pill">${safeVersion}</span>
                <span class="ext-ui-pill muted">Grupo: ${safeGroup}</span>
              </div>
            </div>
            <button class="ext-ui-menu ext-delete-button" type="button" data-id="${safeId}" title="Eliminar extensión" aria-label="Eliminar ${safeName}">🗑</button>
          </header>
          <p class="ext-ui-desc ${safeUri ? '' : 'is-empty'}" title="${safeUri}">${safeUri || 'Sin URI / paquete'}</p>
          <div class="ext-ui-meta">
            <span>📦 ${safeMethod}</span>
            <span class="ext-ui-status ${isActive ? 'on' : 'off'}">${isActive ? 'Activa' : 'Inactiva'}</span>
          </div>
          <footer class="ext-ui-card-foot">
            <div class="ext-ui-actions">
              <span class="ext-ui-btn" style="pointer-events:none; opacity:.72;">Local</span>
            </div>
            <label class="ext-ui-switch ${isActive ? 'on' : ''}" title="${isActive ? 'Desactivar' : 'Activar'}">
              <input type="checkbox" class="ext-toggle-switch" data-id="${safeId}" ${isActive ? 'checked' : ''} style="position:absolute;opacity:0;width:0;height:0;" />
              <span></span>
            </label>
          </footer>
        </article>`;
    }).join('');
  }
};

window.ExtensionManager = ExtensionManager;

// Initialize managers
setTimeout(() => {
  if (window.ProxyManager) window.ProxyManager.init();
  if (window.ExtensionManager) window.ExtensionManager.init();
}, 500);

