export const DEFAULT_API_BASE = "https://iamaxbotcrm.online";
export const API_OVERRIDE_KEY = "apiBaseUrl";
export const GUEST_PASSWORD_KEY = "guestPassword";
export const OWNER_TOKEN_KEY = "ownerToken";
export const REFRESH_TOKEN_KEY = "refreshToken";
export const BOT_EMAIL_KEY = "botEmail";
export const BOT_PASSWORD_KEY = "botPassword";
export const REMEMBER_SESSION_KEY = "iamax_remember_session";

const AUTH_PERSIST_KEYS = new Set([
  OWNER_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  BOT_EMAIL_KEY,
  BOT_PASSWORD_KEY,
  GUEST_PASSWORD_KEY,
  "iamax_admin_role",
  "iamax_must_setup_2fa"
]);

export async function ensureLocalPrefs() {
  // Limpiamos la URL antigua si existía para forzar la V2
  await chrome.storage.local.remove(API_OVERRIDE_KEY);
}

export async function getApiBase() {
  await ensureLocalPrefs();
  return DEFAULT_API_BASE;
}

export async function setApiBase(apiBaseUrl) {
  const value = String(apiBaseUrl || "").trim().replace(/\/+$/, "");

  if (!value) {
    throw new Error("La URL del backend es requerida.");
  }

  await chrome.storage.local.remove(API_OVERRIDE_KEY);

  return DEFAULT_API_BASE;
}

export function isRememberSessionEnabled() {
  try {
    return localStorage.getItem(REMEMBER_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function setRememberSessionEnabled(enabled) {
  try {
    if (enabled) localStorage.setItem(REMEMBER_SESSION_KEY, "1");
    else localStorage.removeItem(REMEMBER_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Lee un secreto: primero session (rápido), si no local (persistente con "Recordar sesión").
 * Con remember activo NO borra el local (antes se borraba y al reiniciar IAmax pedía login otra vez).
 */
async function readSessionSecret(key) {
  const session = await chrome.storage.session.get(key);
  if (session[key]) return session[key];
  const local = await chrome.storage.local.get(key);
  if (local[key]) {
    await chrome.storage.session.set({ [key]: local[key] });
    // Solo migrar-y-borrar del disco si NO hay "Recordar sesión"
    if (!isRememberSessionEnabled() && AUTH_PERSIST_KEYS.has(key)) {
      await chrome.storage.local.remove(key);
    }
    return local[key];
  }
  return "";
}

/**
 * Escribe secreto en session. Si persist=true (Recordar sesión), también en local.
 */
async function writeSessionSecret(key, value, persist = null) {
  const shouldPersist = persist === null ? isRememberSessionEnabled() : Boolean(persist);
  const safe = value || "";
  await chrome.storage.session.set({ [key]: safe });
  if (shouldPersist && safe) {
    await chrome.storage.local.set({ [key]: safe });
  } else {
    await chrome.storage.local.remove(key);
  }
}

export async function getGuestPassword() {
  return readSessionSecret(GUEST_PASSWORD_KEY);
}

export async function setGuestPassword(password, persist = null) {
  await writeSessionSecret(GUEST_PASSWORD_KEY, password || "", persist);
}

export async function getOwnerToken() {
  return readSessionSecret(OWNER_TOKEN_KEY);
}

export async function setOwnerToken(token, persist = null) {
  await writeSessionSecret(OWNER_TOKEN_KEY, token || "", persist);
}

export async function getRefreshToken() {
  return readSessionSecret(REFRESH_TOKEN_KEY);
}

export async function setRefreshToken(token, persist = null) {
  await writeSessionSecret(REFRESH_TOKEN_KEY, token || "", persist);
}

export async function clearAuthTokens() {
  await chrome.storage.session.remove([OWNER_TOKEN_KEY, REFRESH_TOKEN_KEY]);
  await chrome.storage.local.remove([OWNER_TOKEN_KEY, REFRESH_TOKEN_KEY]);
}

/** Cierra sesión de verdad: tokens, credenciales guardadas y "Recordar sesión". */
export async function clearLocalAuthSession() {
  setRememberSessionEnabled(false);

  const keys = [
    OWNER_TOKEN_KEY,
    REFRESH_TOKEN_KEY,
    BOT_EMAIL_KEY,
    BOT_PASSWORD_KEY,
    GUEST_PASSWORD_KEY,
    "iamax_admin_role",
    "iamax_must_setup_2fa",
    REMEMBER_SESSION_KEY
  ];

  try {
    await chrome.storage.session.remove(keys);
  } catch {
    /* ignore */
  }
  try {
    await chrome.storage.local.remove(keys);
  } catch {
    /* ignore */
  }

  try {
    localStorage.removeItem(REMEMBER_SESSION_KEY);
    localStorage.removeItem("iamax_session_role");
    localStorage.removeItem("iamax_admin_role");
  } catch {
    /* ignore */
  }
}

export async function getBotEmail() {
  return readSessionSecret(BOT_EMAIL_KEY);
}

export async function setBotEmail(email, persist = null) {
  await writeSessionSecret(BOT_EMAIL_KEY, email || "", persist);
}

export async function getBotPassword() {
  return readSessionSecret(BOT_PASSWORD_KEY);
}

export async function setBotPassword(password, persist = null) {
  await writeSessionSecret(BOT_PASSWORD_KEY, password || "", persist);
}

