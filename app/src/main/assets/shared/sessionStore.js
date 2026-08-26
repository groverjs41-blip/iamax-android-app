function normalizeKeys(keys) {
  if (Array.isArray(keys)) return keys;
  if (typeof keys === "string") return [keys];
  return Object.keys(keys || {});
}

const PERSIST_SESSION_KEYS = new Set([
  "ownerToken",
  "refreshToken",
  "iamax_admin_role",
  "iamax_must_setup_2fa",
  "botEmail",
  "botPassword",
  "guestPassword"
]);

function isRememberEnabled() {
  try {
    return localStorage.getItem("iamax_remember_session") === "1";
  } catch {
    return false;
  }
}

async function migrateFromLocal(keys) {
  const session = await chrome.storage.session.get(keys);
  const missing = keys.filter((key) => session[key] === undefined);
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
    // Con "Recordar sesión" dejar copia en disco (antes se borraba y al reiniciar pedía login)
    if (!isRememberEnabled()) {
      await chrome.storage.local.remove(Object.keys(toMigrate));
    }
  }

  return session;
}

export async function getSessionValues(keys) {
  return migrateFromLocal(normalizeKeys(keys));
}

export async function setSessionValues(values) {
  await chrome.storage.session.set(values);
  const remember = isRememberEnabled();
  const toPersist = {};
  const toRemoveLocal = [];
  for (const [key, value] of Object.entries(values || {})) {
    if (remember && PERSIST_SESSION_KEYS.has(key) && value !== undefined && value !== null && value !== "") {
      toPersist[key] = value;
    } else {
      toRemoveLocal.push(key);
    }
  }
  if (Object.keys(toPersist).length) {
    await chrome.storage.local.set(toPersist);
  }
  if (toRemoveLocal.length) {
    await chrome.storage.local.remove(toRemoveLocal);
  }
}

export async function removeSessionValues(keys) {
  const normalized = normalizeKeys(keys);
  await chrome.storage.session.remove(normalized);
  await chrome.storage.local.remove(normalized);
}