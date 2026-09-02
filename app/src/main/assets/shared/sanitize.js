export function sanitizeHexColor(value, fallback = "#0f5df5") {
  const normalized = String(value || "").trim();
  if (/^#[0-9a-fA-F]{3}$/.test(normalized)) return normalized;
  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) return normalized;
  if (/^#[0-9a-fA-F]{8}$/.test(normalized)) return normalized;
  return fallback;
}

export function isSafeImageSrc(value) {
  const src = String(value || "").trim();
  if (!src || /[\s"'<>()]/.test(src)) return false;
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(src)) return true;
  if (/^https:\/\/.+/i.test(src)) return true;
  return false;
}

export function sanitizeImageSrc(value) {
  return isSafeImageSrc(value) ? String(value).trim() : "";
}

export function isSafeHttpUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function isSafeUpdateUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return host === "iamaxbotcrm.online" || host.endsWith(".iamaxbotcrm.online") || host.endsWith(".iamax.com") || host === "localhost";
  } catch {
    return false;
  }
}

export function sanitizeCssUrl(value) {
  const safe = sanitizeImageSrc(value);
  return safe ? safe.replace(/"/g, "%22") : "";
}
