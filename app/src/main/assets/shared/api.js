import {
  getApiBase,
  getRefreshToken,
  setOwnerToken,
  setRefreshToken,
  clearAuthTokens,
  clearLocalAuthSession,
  isRememberSessionEnabled,
  setRememberSessionEnabled
} from "./config.js";

let refreshInFlight = null;
const sessionRevisionByCard = new Map();

async function tryRefreshAccessToken() {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = await getRefreshToken();
      if (!refreshToken) return null;

      const apiBase = await getApiBase();
      const endpoints = ["/api/public/refresh", "/api/auth/refresh"];
      const persist = isRememberSessionEnabled();

      for (const path of endpoints) {
        const response = await fetch(`${apiBase}${path}`, {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken })
        });

        if (!response.ok) continue;

        const payload = await response.json();
        if (!payload?.token) continue;

        await setOwnerToken(payload.token, persist);
        if (payload.refreshToken) {
          await setRefreshToken(payload.refreshToken, persist);
        }
        return payload.token;
      }

      return null;
    })().finally(() => {
      refreshInFlight = null;
    });
  }

  return refreshInFlight;
}

/** Intento de renovar access token (exportado para arranque del dashboard). */
export async function refreshAccessTokenIfPossible() {
  return tryRefreshAccessToken();
}

async function request(path, options = {}, allowRefresh = true) {
  const apiBase = await getApiBase();
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  const shouldRefresh = allowRefresh
    && !options._retried
    && response.status === 401
    && typeof payload === "object"
    && (payload?.code === "TOKEN_EXPIRED" || payload?.code === "TOKEN_INVALID" || payload?.code === "AUTH_REQUIRED");

  if (shouldRefresh) {
    const newToken = await tryRefreshAccessToken();
    if (newToken) {
      const retryHeaders = { ...(options.headers || {}) };
      retryHeaders.Authorization = `Bearer ${newToken}`;
      return request(path, { ...options, headers: retryHeaders, _retried: true }, false);
    }
  }

  if (!response.ok) {
    const message = typeof payload === "object" && payload?.error ? payload.error : `Error ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.code = typeof payload === "object" ? payload?.code : undefined;
    error.payload = payload;
    throw error;
  }

  return payload;
}

export async function persistAuthTokens(loginData = {}, rememberMe = null) {
  const persist = rememberMe === null
    ? isRememberSessionEnabled()
    : Boolean(rememberMe);
  if (persist) setRememberSessionEnabled(true);
  else if (rememberMe === false) setRememberSessionEnabled(false);

  const token = loginData.token || loginData.accessToken || "";
  // No borrar tokens existentes si la respuesta es solo MFA (sin token aún)
  if (loginData.requires2fa && !token) return;

  if (token) {
    await setOwnerToken(token, persist);
  }
  if (loginData.refreshToken) {
    await setRefreshToken(loginData.refreshToken, persist);
  }
}

export async function logoutSession() {
  const apiBase = await getApiBase();
  const accessToken = await import("./config.js").then((mod) => mod.getOwnerToken());
  try {
    if (accessToken) {
      await fetch(`${apiBase}/api/public/logout`, {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        }
      });
    }
  } catch (error) {
    console.warn("No se pudo revocar la sesion remota:", error);
  }
  // Tokens + email/password guardados + remember session (evita auto-login a 2FA)
  await clearLocalAuthSession();
  await clearAuthTokens();
}

export async function getDashboardData(guestPassword = "", ownerToken = "") {
  const headers = {
    "X-Guest-Password": guestPassword
  };
  if (ownerToken) {
    headers.Authorization = `Bearer ${ownerToken}`;
  }
  return request("/api/public/dashboard", { headers });
}

function buildAccessHeaders(guestPassword = "", ownerToken = "") {
  const headers = {};
  if (guestPassword) {
    headers["X-Guest-Password"] = guestPassword;
  }
  if (ownerToken) {
    headers.Authorization = `Bearer ${ownerToken}`;
  }
  return headers;
}

export async function getCardSecrets(cardId, guestPassword = "", ownerToken = "") {
  return request(`/api/public/cards/${cardId}/secrets`, {
    headers: buildAccessHeaders(guestPassword, ownerToken)
  });
}

export async function trackLaunch(cardId, guestPassword = "", ownerToken = "") {
  return request(`/api/public/cards/${cardId}/launch`, {
    method: "POST",
    headers: buildAccessHeaders(guestPassword, ownerToken)
  });
}

export async function reportBrokenCard(cardId, guestPassword = "", ownerToken = "") {
  return request(`/api/public/cards/${cardId}/report`, {
    method: "POST",
    headers: buildAccessHeaders(guestPassword, ownerToken)
  });
}

export async function getAdminLoginUrl() {
  const apiBase = await getApiBase();
  return `${apiBase}/login.html`;
}

export async function loginAsOwner(email, password, rememberMe = false) {
  const payload = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password, rememberMe })
  });
  await persistAuthTokens(payload, rememberMe);
  return payload;
}

export async function loginAsClient(email, password, deviceId, rememberMe = false) {
  const manifest = chrome.runtime.getManifest();
  const extensionVersion = manifest.version || "1.0.0";

  const payload = await request("/api/public/login", {
    method: "POST",
    body: JSON.stringify({ email, password, deviceId, extensionVersion, rememberMe })
  });
  await persistAuthTokens(payload, rememberMe);
  return payload;
}

export async function downloadSession(cardId, guestPassword, ownerToken = "") {
  const headers = {
    "X-Guest-Password": guestPassword
  };
  if (ownerToken) {
    headers.Authorization = `Bearer ${ownerToken}`;
  }
  const payload = await request(`/api/sessions/download/${cardId}`, { headers });
  if (payload?.revision) sessionRevisionByCard.set(String(cardId), String(payload.revision));
  return payload;
}

export async function get2FACodes(guestPassword = "", ownerToken = "") {
  if (!ownerToken) {
    throw new Error("Debes iniciar sesion para ver los codigos 2FA.");
  }
  return request("/api/public/2fa", {
    headers: buildAccessHeaders(guestPassword, ownerToken)
  });
}

export async function getTutorials(guestPassword = "", ownerToken = "") {
  const headers = {
    "X-Guest-Password": guestPassword
  };
  if (ownerToken) {
    headers.Authorization = `Bearer ${ownerToken}`;
  }
  return request("/api/public/tutorials", { headers });
}

export async function getLiveTracking(ownerToken = "") {
  return request("/api/public/tracking/live", {
    headers: buildAccessHeaders("", ownerToken)
  });
}

export async function getReferralSummary(token) {
  return request("/api/public/referrals", {
    headers: { Authorization: `Bearer ${token}` }
  });
}

export async function applyReferralCode(token, code) {
  return request("/api/public/referrals/apply", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ code })
  });
}

export async function redeemReferralReward(token, rewardKey) {
  return request("/api/public/referrals/redeem", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ rewardKey })
  });
}

export async function uploadSession(cardId, sessionData, ownerToken) {
  const cardKey = String(cardId);
  if (!sessionRevisionByCard.has(cardKey)) {
    try { await downloadSession(cardId, "", ownerToken); } catch (error) { /* La fila puede ser nueva. */ }
  }

  const sendUpload = (expectedRevision) => request(`/api/sessions/upload/${cardId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ownerToken}`
    },
    body: JSON.stringify({
      ...sessionData,
      expected_revision: expectedRevision || null,
      source_device_id: sessionData?.source_device_id || "extension"
    })
  });

  try {
    const payload = await sendUpload(
      sessionRevisionByCard.get(cardKey) || sessionData?.revision || null
    );
    if (payload?.revision) sessionRevisionByCard.set(cardKey, String(payload.revision));
    return payload;
  } catch (error) {
    const canResync = error?.status === 409
      || error?.status === 428
      || error?.code === "SESSION_CONFLICT"
      || error?.code === "SESSION_REVISION_REQUIRED";
    if (!canResync) throw error;

    let currentRevision = error?.payload?.current_revision || null;
    if (!currentRevision) {
      try {
        await downloadSession(cardId, "", ownerToken);
        currentRevision = sessionRevisionByCard.get(cardKey) || null;
      } catch (downloadError) {
        currentRevision = null;
      }
    }
    if (!currentRevision) throw error;

    sessionRevisionByCard.set(cardKey, String(currentRevision));
    const payload = await sendUpload(currentRevision);
    if (payload?.revision) sessionRevisionByCard.set(cardKey, String(payload.revision));
    return payload;
  }
}

export async function verify2faOwner(mfaToken, code, rememberMe = false) {
  const payload = await request("/api/auth/verify-2fa", {
    method: "POST",
    body: JSON.stringify({ mfaToken, code, rememberMe })
  });
  await persistAuthTokens(payload, rememberMe);
  return payload;
}

const BOT_HOME_PATH = "/client/live-chat";
const BOT_FRONTEND_VERSION = "1.3.5-payments-fix";

function buildBotRedirect(path = BOT_HOME_PATH) {
  return `${path}?v=${encodeURIComponent(BOT_FRONTEND_VERSION)}&cache=${Date.now()}`;
}

export async function buildBotAutoLoginUrl(token, redirectPath = BOT_HOME_PATH) {
  const apiBase = await getApiBase();
  const response = await fetch(`${apiBase}/api/auth/auto/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ redirect: buildBotRedirect(redirectPath) })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.url) {
    const error = new Error(payload.error || "No se pudo abrir el Bot WhatsApp.");
    error.code = payload.code;
    throw error;
  }
  return `${apiBase}${payload.url}`;
}

export async function buildBotBridgeUrl(token, redirectPath = BOT_HOME_PATH) {
  const apiBase = await getApiBase();
  const params = new URLSearchParams({
    token,
    redirect: buildBotRedirect(redirectPath)
  });
  return `${apiBase}/auth/bridge?${params.toString()}`;
}

export async function resolveBotAutoLoginUrl(redirectPath = BOT_HOME_PATH) {
  let token = await import("./config.js").then((mod) => mod.getOwnerToken());
  if (!token) {
    const error = new Error("Inicia sesion en el panel para abrir tu Bot WhatsApp.");
    error.code = "TOKEN_REQUIRED";
    throw error;
  }

  try {
    return await buildBotAutoLoginUrl(token, redirectPath);
  } catch (error) {
    const refreshedToken = await tryRefreshAccessToken();
    if (refreshedToken) {
      try {
        return await buildBotAutoLoginUrl(refreshedToken, redirectPath);
      } catch {
        return buildBotBridgeUrl(refreshedToken, redirectPath);
      }
    }
    return buildBotBridgeUrl(token, redirectPath);
  }
}
