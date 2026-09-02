/**
 * Garantiza Chromium embebido de IAmax.
 * - Chromium estÃ¡ndar/MEDIA para las herramientas normales.
 * - Edge IAmax privado para compatibilidad explícita.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const EDGE_ENTERPRISE_API = 'https://edgeupdates.microsoft.com/api/products?view=enterprise';
/** Chromium real vía snapshots/build MEDIA. */
const SNAPSHOT_BASE = 'https://commondatastorage.googleapis.com/chromium-browser-snapshots';

/** Carpetas Chromium estÃ¡ndar (no Testing) */
const STANDARD_PLATFORM_DIR = {
  win64: 'chromium-standard-win64',
  win32: 'chromium-standard-win',
  'mac-x64': 'chromium-standard-mac-x64',
  'mac-arm64': 'chromium-standard-mac-arm64',
  linux64: 'chromium-standard-linux64',
  'linux-arm64': 'chromium-standard-linux-arm64',
};

/** Prefijo de snapshot + nombre del zip por plataforma */
const SNAPSHOT_META = {
  win64: { prefix: 'Win_x64', zip: 'chrome-win.zip' },
  win32: { prefix: 'Win', zip: 'chrome-win.zip' },
  'mac-x64': { prefix: 'Mac', zip: 'chrome-mac.zip' },
  'mac-arm64': { prefix: 'Mac_Arm', zip: 'chrome-mac.zip' },
  linux64: { prefix: 'Linux_x64', zip: 'chrome-linux.zip' },
  'linux-arm64': { prefix: 'Linux_Arm', zip: 'chrome-linux.zip' },
};

let standardInstallPromise = null;
let edgeInstallPromise = null;
let chromeIamaxInstallPromise = null;

/** Chrome for Testing (Chrome real) embebido en IAmax — NO el Chrome del Program Files */
const CFT_LAST_GOOD =
  'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json';
const CHROME_IAMAX_DIR = {
  win64: 'chrome-iamax-win64',
  win32: 'chrome-iamax-win32',
  'mac-x64': 'chrome-iamax-mac-x64',
  'mac-arm64': 'chrome-iamax-mac-arm64',
  linux64: 'chrome-iamax-linux64',
  'linux-arm64': 'chrome-iamax-linux-arm64'
};
const CFT_PLATFORM = {
  win64: 'win64',
  win32: 'win64',
  'mac-x64': 'mac-x64',
  'mac-arm64': 'mac-arm64',
  linux64: 'linux64',
  'linux-arm64': 'linux64'
};

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'IAmax-Desktop' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchJson(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'IAmax-Desktop' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        try { fs.unlinkSync(dest); } catch { /* ignore */ }
        downloadFile(res.headers.location, dest, onProgress).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        reject(new Error(`HTTP ${res.statusCode} descargando Chromium`));
        return;
      }
      const total = Number(res.headers['content-length'] || 0);
      let done = 0;
      let lastPct = -1;
      res.on('data', (chunk) => {
        done += chunk.length;
        if (total > 0 && typeof onProgress === 'function') {
          const pct = Math.floor((done / total) * 100);
          if (pct !== lastPct && pct % 5 === 0) {
            lastPct = pct;
            onProgress(pct, done, total);
          }
        }
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    });
    req.on('error', (err) => {
      try { file.close(); fs.unlinkSync(dest); } catch { /* ignore */ }
      reject(err);
    });
  });
}

function platformKey(override) {
  if (override && typeof override === 'string') return override;
  if (process.platform === 'win32') return process.arch === 'ia32' ? 'win32' : 'win64';
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  if (process.platform === 'linux') return process.arch === 'arm64' ? 'linux-arm64' : 'linux64';
  return 'linux64';
}

/**
 * macOS: quita cuarentena Gatekeeper del .app (si no, Chromium crashea al abrir con extensiones).
 * Seguro llamar tambiÃ©n en Windows/Linux (no-op).
 */
function clearMacQuarantine(chromeExecutable) {
  if (process.platform !== 'darwin' || !chromeExecutable) return;
  try {
    let target = path.resolve(chromeExecutable);
    // Subir hasta el .app bundle si estamos en .../Chromium.app/Contents/MacOS/Chromium
    const appIdx = target.toLowerCase().indexOf('.app/');
    if (appIdx > 0) {
      target = target.slice(0, appIdx + 4);
    } else if (!target.endsWith('.app')) {
      // buscar Chromium.app en padres
      let dir = path.dirname(target);
      for (let i = 0; i < 6; i++) {
        if (dir.endsWith('.app')) {
          target = dir;
          break;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
    execFileSync('xattr', ['-cr', target], { stdio: 'pipe' });
    console.log('[Browser] macOS quarantine cleared:', target);
  } catch (e) {
    console.warn('[Browser] xattr quarantine:', e.message);
  }
}

/**
 * Locks de perfil macOS/Chromium que dejan el perfil â€œmuertoâ€ tras un crash.
 */
function clearChromiumProfileLocks(userDataDir) {
  if (!userDataDir) return;
  const names = [
    'SingletonLock',
    'SingletonCookie',
    'SingletonSocket',
    'lockfile',
    'RunningChromeVersion'
  ];
  for (const name of names) {
    try {
      const p = path.join(userDataDir, name);
      if (fs.existsSync(p)) fs.rmSync(p, { force: true, recursive: true });
    } catch { /* ignore */ }
  }
  try {
    const def = path.join(userDataDir, 'Default');
    for (const name of ['LOCK', 'lockfile']) {
      const p = path.join(def, name);
      if (fs.existsSync(p)) fs.rmSync(p, { force: true });
    }
  } catch { /* ignore */ }
}

function findChromeExe(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  const stack = [dir];
  const exeNames = process.platform === 'win32'
    ? ['chrome.exe', 'chromium.exe']
    : process.platform === 'darwin'
      ? ['Google Chrome for Testing', 'Chromium', 'chrome', 'Google Chrome']
      : ['chrome', 'chromium', 'google-chrome', 'chrome-wrapper'];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        // macOS app bundle
        if (process.platform === 'darwin' && e.name.endsWith('.app')) {
          const macApp = path.join(full, 'Contents', 'MacOS', 'Google Chrome for Testing');
          if (fs.existsSync(macApp)) return macApp;
          const macChromium = path.join(full, 'Contents', 'MacOS', 'Chromium');
          if (fs.existsSync(macChromium)) return macChromium;
          const macChrome = path.join(full, 'Contents', 'MacOS', 'Google Chrome');
          if (fs.existsSync(macChrome)) return macChrome;
        }
        stack.push(full);
        continue;
      }
      if (exeNames.some((n) => e.name === n || e.name.toLowerCase() === n.toLowerCase())) {
        return full;
      }
    }
    if (process.platform === 'darwin') {
      const macApp = path.join(cur, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
      if (fs.existsSync(macApp)) return macApp;
      const macChromiumApp = path.join(cur, 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
      if (fs.existsSync(macChromiumApp)) return macChromiumApp;
    }
  }
  return null;
}

function standardSearchRoots(installDir, platform = platformKey()) {
  const roots = [];
  const sub = STANDARD_PLATFORM_DIR[platform];
  // 1) PRIMERO el Chromium del instalador (resources/browser) — no depender de internet
  try {
    if (process.resourcesPath) {
      if (sub) roots.push(path.join(process.resourcesPath, 'browser', sub));
      roots.push(path.join(process.resourcesPath, 'browser'));
      roots.push(path.join(process.resourcesPath, 'browser', 'chromium-standard'));
    }
  } catch { /* ignore */ }
  // 2) Copia de desarrollo / junto a la app
  const appRoot = path.join(__dirname, '..');
  if (sub) roots.push(path.join(appRoot, 'browser', sub));
  roots.push(path.join(appRoot, 'browser'));
  roots.push(path.join(appRoot, 'browser', 'chromium-standard'));
  // 3) Copia en userData (descargas / upgrades en runtime)
  if (installDir) {
    if (sub) roots.push(path.join(installDir, sub));
    roots.push(installDir);
    roots.push(path.join(installDir, 'chromium-standard'));
  }
  return [...new Set(roots.filter(Boolean))];
}

/** true si el exe viene del paquete instalado (no hay que re-descargar). */
function isPackagedBrowserPath(exePath) {
  if (!exePath) return false;
  try {
    const resolved = path.resolve(exePath).toLowerCase();
    if (process.resourcesPath) {
      const res = path.resolve(process.resourcesPath).toLowerCase();
      if (resolved.startsWith(res + path.sep) || resolved.startsWith(res)) return true;
    }
  } catch { /* ignore */ }
  // Dev / unpacked: iamax-desktop/browser/...
  if (/[/\\]browser[/\\]chromium-standard/i.test(String(exePath))) {
    if (!/[/\\]iamax-browser[/\\]|[/\\]AppData[/\\]Roaming[/\\]/i.test(String(exePath))) {
      return true;
    }
  }
  return false;
}

/**
 * Meta IAMAX_CHROMIUM_STANDARD.json: userData, resources del instalador o junto al exe.
 */
function readChromiumMetaNear(installDir, platform = platformKey()) {
  const candidates = [];
  if (installDir) {
    candidates.push(path.join(installDir, 'IAMAX_CHROMIUM_STANDARD.json'));
  }
  try {
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, 'browser', 'IAMAX_CHROMIUM_STANDARD.json'));
    }
  } catch { /* ignore */ }
  const appRoot = path.join(__dirname, '..');
  candidates.push(path.join(appRoot, 'browser', 'IAMAX_CHROMIUM_STANDARD.json'));
  for (const root of standardSearchRoots(installDir, platform)) {
    candidates.push(path.join(root, 'IAMAX_CHROMIUM_STANDARD.json'));
    try {
      candidates.push(path.join(path.dirname(root), 'IAMAX_CHROMIUM_STANDARD.json'));
    } catch { /* ignore */ }
  }
  for (const p of [...new Set(candidates.filter(Boolean))]) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      }
    } catch { /* next */ }
  }
  return null;
}

function findExistingStandardChromium(installDir, platform = platformKey()) {
  const meta = readChromiumMetaNear(installDir, platform) || readChromiumMeta(installDir);
  const wantMedia = platform === 'win64' || platform === 'win32' || process.platform === 'win32';

  // Recolectar todos los chrome.exe candidatos
  const found = [];
  for (const root of standardSearchRoots(installDir, platform)) {
    const exe = findChromeExe(root);
    if (!exe) continue;
    if (/chromium-standard/i.test(exe) || /chromium-standard/i.test(root)) {
      found.push(exe);
    }
  }
  // Fallback: cualquier chrome en roots de browser
  if (!found.length) {
    for (const root of standardSearchRoots(installDir, platform)) {
      const exe = findChromeExe(root);
      if (exe) found.push(exe);
    }
  }

  // 1) Siempre preferir el embebido del instalador (funciona offline, ya es MEDIA en builds IAmax)
  const packaged = found.find((exe) => isPackagedBrowserPath(exe));
  if (packaged && fs.existsSync(packaged)) {
    console.log('[Browser] Chromium embebido del instalador:', packaged);
    return packaged;
  }

  // 2) userData con meta MEDIA OK
  if (found.length) {
    const mediaOk = meta && meta.proprietary_codecs === true;
    if (!wantMedia || mediaOk) {
      console.log('[Browser] Chromium en disco:', found[0]);
      return found[0];
    }
    // Windows + Chromium viejo open (sin codecs) en userData → forzar re-descarga MEDIA
    // NO aplica al empaquetado (ya retornamos arriba).
    console.log('[Browser] Chromium open en userData sin codecs MEDIA → re-descargar');
    return null;
  }

  return null;
}

async function fetchText(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'IAmax-Desktop' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchText(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').trim()));
    }).on('error', reject);
  });
}

function readChromiumMeta(installDir) {
  try {
    if (!installDir) return null;
    const p = path.join(installDir, 'IAMAX_CHROMIUM_STANDARD.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeChromiumMeta(installDir, data) {
  fs.writeFileSync(
    path.join(installDir, 'IAMAX_CHROMIUM_STANDARD.json'),
    JSON.stringify(data, null, 2),
    'utf8'
  );
}

/**
 * Extrae .7z (Hibbiki chrome.7z). Usa 7-Zip del sistema o 7za portable.
 */
async function extract7zArchive(archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const candidates = [];
  if (process.platform === 'win32') {
    candidates.push(
      path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', '7-Zip', '7z.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', '7-Zip', '7z.exe'),
      '7z.exe',
      '7z'
    );
  } else {
    candidates.push('7z', '7za', '/usr/bin/7z');
  }

  let seven = null;
  for (const c of candidates) {
    try {
      execFileSync(c, ['--help'], { stdio: 'ignore' });
      seven = c;
      break;
    } catch { /* try next */ }
  }

  if (!seven && process.platform === 'win32') {
    // 7za portable (extra-light)
    const sevenDir = path.join(destDir, '..', '_7za');
    const sevenZip = path.join(sevenDir, '7za.exe');
    if (!fs.existsSync(sevenZip)) {
      fs.mkdirSync(sevenDir, { recursive: true });
      const sevenUrl = 'https://github.com/ip7z/7zip/releases/download/24.09/7za.exe';
      // Fallback mirror if github asset layout differs â€” use known 7-zip extra
      try {
        await downloadFile('https://www.7-zip.org/a/7zr.exe', sevenZip);
      } catch {
        await downloadFile(sevenUrl, sevenZip).catch(async () => {
          throw new Error('No hay 7-Zip y no se pudo descargar 7zr.exe');
        });
      }
    }
    if (fs.existsSync(sevenZip)) seven = sevenZip;
  }

  if (!seven) {
    throw new Error('Se necesita 7-Zip para extraer Chromium media (chrome.7z)');
  }

  console.log('[Browser] Extrayendo 7z con', seven);
  execFileSync(seven, ['x', archivePath, `-o${destDir}`, '-y'], {
    stdio: 'inherit',
    windowsHide: true,
    timeout: 600000
  });
}

/**
 * Chromium Windows con codecs propietarios (H.264/AAC) â€” Hibbiki build.
 * Mismo uso que el estÃ¡ndar: todas las tarjetas IAmax (IAs + media).
 * NO usa Chrome instalado en el PC del usuario.
 */
async function downloadMediaChromiumWin64(installDir, opts = {}) {
  const platform = 'win64';
  const targetSub = STANDARD_PLATFORM_DIR[platform];
  const extractRoot = path.join(installDir, targetSub);
  fs.mkdirSync(installDir, { recursive: true });

  console.log('[Browser] Resolviendo Chromium MEDIA (codecs H.264/AAC, win64)...');
  const release = await fetchJson(
    'https://api.github.com/repos/Hibbiki/chromium-win64/releases/latest'
  );
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const asset = assets.find((a) => String(a.name || '').toLowerCase() === 'chrome.7z')
    || assets.find((a) => /\.7z$/i.test(String(a.name || '')));
  if (!asset?.browser_download_url) {
    throw new Error('Release Hibbiki sin chrome.7z');
  }

  const tag = String(release.tag_name || 'latest');
  const tmp7z = path.join(installDir, `chromium-media-${platform}.tmp.7z`);
  if (fs.existsSync(tmp7z)) {
    try { fs.unlinkSync(tmp7z); } catch { /* ignore */ }
  }

  console.log('[Browser] Descargando Chromium MEDIA', tag, '(~400MB, no Chrome del PC)...');
  await downloadFile(asset.browser_download_url, tmp7z, opts.onProgress);

  try {
    fs.rmSync(extractRoot, { recursive: true, force: true });
  } catch { /* ignore */ }
  fs.mkdirSync(extractRoot, { recursive: true });

  await extract7zArchive(tmp7z, extractRoot);
  try { fs.unlinkSync(tmp7z); } catch { /* ignore */ }

  const exe = findChromeExe(extractRoot);
  if (!exe) {
    throw new Error('Chromium MEDIA extraÃ­do sin chrome.exe');
  }

  // Widevine en el MISMO chrome.exe (streaming Peacock/Netflix + IAs)
  let widevine = { ok: false };
  try {
    widevine = await ensureWidevineCdm(exe);
  } catch (e) {
    console.warn('[Browser] Widevine post-MEDIA:', e.message);
  }

  writeChromiumMeta(installDir, {
    kind: 'chromium-media',
    proprietary_codecs: true,
    widevine: Boolean(widevine?.ok),
    notChromeForTesting: true,
    notSystemChrome: true,
    tag,
    platform,
    source: asset.browser_download_url,
    path: exe,
    installedAt: new Date().toISOString(),
    note: 'H.264/AAC + Widevine para IAs (SuperGrok) y streaming (Peacock); mismo flujo IAmax'
  });

  console.log(
    '[Browser] Chromium MEDIA listo (codecs + Widevine, sin Chrome del PC):',
    exe,
    '| widevine=',
    widevine?.ok ? 'OK' : (widevine?.error || 'pending')
  );
  return exe;
}

/**
 * Descarga Chromium para tarjetas IAmax.
 * Windows: prioriza build con codecs (media). Fallback: snapshot open.
 * mac/linux: snapshot open (como antes).
 * No usa Chrome del cliente.
 */
async function downloadStandardChromiumTo(installDir, platform, opts = {}) {
  const plat = platform || platformKey();

  // Windows: Chromium con codecs â€” arregla vÃ­deo en SuperGrok / IAs sin cambiar el flujo
  if (plat === 'win64' || plat === 'win32') {
    try {
      return await downloadMediaChromiumWin64(installDir, opts);
    } catch (e) {
      console.warn('[Browser] Chromium MEDIA fallÃ³, fallback snapshot open:', e.message);
    }
  }

  const meta = SNAPSHOT_META[plat] || SNAPSHOT_META.win64;
  const targetSub = STANDARD_PLATFORM_DIR[plat] || 'chromium-standard';
  const extractRoot = path.join(installDir, targetSub);
  fs.mkdirSync(installDir, { recursive: true });

  const lastChangeUrl = `${SNAPSHOT_BASE}/${meta.prefix}/LAST_CHANGE`;
  console.log(`[Browser] Resolviendo Chromium estÃ¡ndar (${plat})...`);
  let revision = await fetchText(lastChangeUrl);
  if (!/^\d+$/.test(revision)) {
    throw new Error(`RevisiÃ³n de Chromium invÃ¡lida: ${revision}`);
  }

  let packUrl = null;
  let usedRevision = revision;
  for (let i = 0; i < 30; i++) {
    const rev = String(Number(revision) - i);
    const candidate = `${SNAPSHOT_BASE}/${meta.prefix}/${rev}/${meta.zip}`;
    try {
      const ok = await new Promise((resolve) => {
        const lib = candidate.startsWith('https') ? https : http;
        const req = lib.request(candidate, { method: 'HEAD', headers: { 'User-Agent': 'IAmax-Desktop' } }, (res) => {
          resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.end();
      });
      if (ok) {
        packUrl = candidate;
        usedRevision = rev;
        break;
      }
    } catch {
      /* try previous */
    }
  }
  if (!packUrl) {
    throw new Error(`No se encontrÃ³ zip de Chromium estÃ¡ndar para ${plat}`);
  }

  const tmpZip = path.join(installDir, `chromium-standard-${plat}.tmp.zip`);
  if (fs.existsSync(tmpZip)) {
    try { fs.unlinkSync(tmpZip); } catch { /* ignore */ }
  }

  console.log(`[Browser] Descargando Chromium estÃ¡ndar r${usedRevision} (no Testing)...`);
  await downloadFile(packUrl, tmpZip, opts.onProgress);

  try {
    fs.rmSync(extractRoot, { recursive: true, force: true });
  } catch { /* ignore */ }
  fs.mkdirSync(extractRoot, { recursive: true });

  console.log(`[Browser] Extrayendo Chromium estÃ¡ndar a ${extractRoot}...`);
  extractZip(tmpZip, extractRoot);
  try { fs.unlinkSync(tmpZip); } catch { /* ignore */ }

  if (process.platform !== 'win32') {
    try {
      const exeFound = findChromeExe(extractRoot);
      if (exeFound) execFileSync('chmod', ['+x', exeFound], { stdio: 'pipe' });
    } catch { /* ignore */ }
  }

  const exe = findChromeExe(extractRoot);
  if (!exe) {
    throw new Error(`Chromium estÃ¡ndar (${plat}) sin ejecutable`);
  }
  clearMacQuarantine(exe);

  writeChromiumMeta(installDir, {
    kind: 'chromium-standard',
    proprietary_codecs: false,
    notChromeForTesting: true,
    revision: usedRevision,
    platform: plat,
    source: packUrl,
    path: exe,
    installedAt: new Date().toISOString()
  });

  console.log('[Browser] Chromium estÃ¡ndar listo (sin Chrome del cliente):', exe);
  return exe;
}

/**
 * Asegura Chromium estÃ¡ndar embebido (no CfT, no Chrome del SO).
 */
async function ensureStandardChromium(opts = {}) {
  const force = Boolean(opts.force);
  const platform = platformKey(opts.platform);
  const installDir = opts.installDir
    || path.join(require('os').homedir(), '.iamax-browser');

  if (!force) {
    const existing = findExistingStandardChromium(installDir, platform);
    if (existing && fs.existsSync(existing)) {
      console.log('[Browser] Chromium listo (sin descarga):', existing);
      return existing;
    }
  }

  // Último intento: buscar otra vez embebido (por si force / race)
  if (!force) {
    try {
      const resBrowser = process.resourcesPath
        ? path.join(process.resourcesPath, 'browser')
        : null;
      if (resBrowser && fs.existsSync(resBrowser)) {
        const packed = findChromeExe(resBrowser);
        if (packed && fs.existsSync(packed)) {
          console.log('[Browser] Usando Chromium embebido (fallback resources):', packed);
          return packed;
        }
      }
    } catch { /* ignore */ }
  }

  if (standardInstallPromise && !force) return standardInstallPromise;

  standardInstallPromise = (async () => {
    console.log(`[Browser] Chromium no embebido (${platform}) — descargando MEDIA…`);
    if (typeof opts.askPermission === 'function') {
      const allowed = await opts.askPermission({ type: 'download', sizeMb: 200, platform, kind: 'chromium-standard' });
      if (!allowed) {
        const denied = new Error('USER_DENIED_BROWSER_INSTALL');
        denied.code = 'USER_DENIED';
        throw denied;
      }
    }
    try {
      // Timeout duro: no dejar a clientes colgados en "Cargando…" 10+ min
      const downloadPromise = downloadStandardChromiumTo(installDir, platform, opts);
      const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 180000;
      let timer;
      const timed = new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error(
            `Timeout ${Math.round(timeoutMs / 1000)}s descargando Chromium. ` +
            'Reinstala IAmax (incluye el navegador) o revisa internet/antivirus.'
          );
          err.code = 'DOWNLOAD_TIMEOUT';
          reject(err);
        }, timeoutMs);
      });
      try {
        return await Promise.race([downloadPromise, timed]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch (error) {
      // Si la descarga falla, reintentar embebido una vez más (mejor que error ciego)
      try {
        const packed = findExistingStandardChromium(installDir, platform);
        if (packed && fs.existsSync(packed)) {
          console.warn('[Browser] Descarga falló; usando embebido:', packed, error.message);
          return packed;
        }
      } catch { /* ignore */ }
      if (isPermissionError(error) && typeof opts.askPermission === 'function') {
        const retry = await opts.askPermission({ type: 'permission_error', error: error.message });
        if (retry) return downloadStandardChromiumTo(installDir, platform, opts);
      }
      throw error;
    }
  })().finally(() => {
    standardInstallPromise = null;
  });

  return standardInstallPromise;
}

function isPermissionError(error) {
  const msg = String(error && error.message ? error.message : error || '');
  const code = String(error && error.code ? error.code : '');
  return (
    code === 'EACCES'
    || code === 'EPERM'
    || code === 'EBUSY'
    || /eacces|eperm|access is denied|permiso|permission denied|denied|blocked|antivirus/i.test(msg)
  );
}

function extractZip(tmpZip, extractRoot) {
  if (process.platform === 'win32') {
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${tmpZip.replace(/'/g, "''")}' -DestinationPath '${extractRoot.replace(/'/g, "''")}' -Force`
    ], { stdio: 'pipe', windowsHide: true });
  } else {
    execFileSync('unzip', ['-o', tmpZip, '-d', extractRoot], { stdio: 'pipe' });
  }
}

/**
 * Widevine CDM para streaming (Peacock/Netflix) + IAs en el MISMO Chromium IAmax.
 * Descarga componente oficial (misma fuente que Firefox), NO Chrome del PC.
 */
let widevinePromise = null;

const MOZILLA_WIDEVINE_JSON =
  'https://raw.githubusercontent.com/mozilla-firefox/firefox/refs/heads/main/toolkit/content/gmp-sources/widevinecdm.json';

function widevineSubdir(platform = platformKey()) {
  if (platform === 'win64' || platform === 'win32') return platform === 'win32' ? 'win_x86' : 'win_x64';
  if (platform === 'mac-arm64') return 'mac_arm64';
  if (platform.startsWith('mac')) return 'mac_x64';
  if (platform === 'linux-arm64') return 'linux_arm64';
  return 'linux_x64';
}

function widevineDllName(platform = platformKey()) {
  if (platform.startsWith('win')) return 'widevinecdm.dll';
  if (platform.startsWith('mac')) return 'libwidevinecdm.dylib';
  return 'libwidevinecdm.so';
}

function chromeDirFromExe(chromeExe) {
  return path.dirname(path.resolve(String(chromeExe || '')));
}

function widevinePresent(chromeExe, platform = platformKey()) {
  try {
    const base = path.join(chromeDirFromExe(chromeExe), 'WidevineCdm');
    const dll = path.join(base, '_platform_specific', widevineSubdir(platform), widevineDllName(platform));
    const manifest = path.join(base, 'manifest.json');
    return fs.existsSync(dll) && fs.existsSync(manifest);
  } catch {
    return false;
  }
}

/** Plataforma clave en widevinecdm.json de Mozilla. */
function mozillaWidevinePlatformKey(platform = platformKey()) {
  if (platform === 'win64') return 'WINNT_x86_64-msvc';
  if (platform === 'win32') return 'WINNT_x86-msvc';
  if (platform === 'mac-arm64') return 'Darwin_aarch64-gcc3';
  if (platform.startsWith('mac')) return 'Darwin_x86_64-gcc3-u-i386-x86_64';
  if (platform === 'linux-arm64') return 'Linux_x86_64-gcc3'; // fallback x64
  return 'Linux_x86_64-gcc3';
}

/**
 * CRX3 = "Cr24" + version(u32) + headerSize(u32) + header + zip payload
 */
function crx3ToZipBuffer(crxBuf) {
  if (!Buffer.isBuffer(crxBuf) || crxBuf.length < 16) {
    throw new Error('CRX vacÃ­o');
  }
  const magic = crxBuf.toString('utf8', 0, 4);
  if (magic === 'Cr24') {
    const headerSize = crxBuf.readUInt32LE(8);
    const zipStart = 12 + headerSize;
    if (zipStart >= crxBuf.length) throw new Error('CRX3 header invÃ¡lido');
    return crxBuf.subarray(zipStart);
  }
  // Ya es zip (PK)
  if (crxBuf[0] === 0x50 && crxBuf[1] === 0x4b) return crxBuf;
  throw new Error('Formato Widevine desconocido (no CRX3/zip)');
}

function extractZipSafe(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(zipPath)) {
      reject(new Error(`zip no existe: ${zipPath}`));
      return;
    }
    const st = fs.statSync(zipPath);
    if (!st.size || st.size < 1000) {
      reject(new Error(`zip vacÃ­o o corrupto (${st.size || 0} B)`));
      return;
    }
    try {
      const unzipper = require('unzipper');
      const stream = fs.createReadStream(zipPath);
      stream.on('error', reject);
      const extract = unzipper.Extract({ path: destDir });
      extract.on('error', reject);
      extract.on('close', () => resolve());
      stream.pipe(extract);
    } catch (e) {
      try {
        if (process.platform === 'win32') {
          execFileSync('powershell.exe', [
            '-NoProfile', '-Command',
            `Expand-Archive -LiteralPath '${String(zipPath).replace(/'/g, "''")}' -DestinationPath '${String(destDir).replace(/'/g, "''")}' -Force`
          ], { stdio: 'ignore', windowsHide: true, timeout: 60000 });
          resolve();
        } else {
          execFileSync('unzip', ['-o', zipPath, '-d', destDir], { stdio: 'ignore', timeout: 60000 });
          resolve();
        }
      } catch (e2) {
        reject(e2);
      }
    }
  });
}

async function resolveWidevineDownloadUrl(platform = platformKey()) {
  const json = await fetchJson(MOZILLA_WIDEVINE_JSON);
  const vendor = json?.vendors?.['gmp-widevinecdm'];
  if (!vendor?.platforms) throw new Error('widevinecdm.json invÃ¡lido');
  let key = mozillaWidevinePlatformKey(platform);
  let entry = vendor.platforms[key];
  // Resolver alias
  for (let i = 0; i < 4 && entry?.alias; i += 1) {
    key = entry.alias;
    entry = vendor.platforms[key];
  }
  const url = entry?.fileUrl || entry?.mirrorUrls?.[0];
  if (!url) throw new Error(`Sin URL Widevine para ${platform} (${key})`);
  return {
    url,
    version: String(vendor.version || json.name || '4.10.3050.0').replace(/^Widevine-/, ''),
    platformKey: key
  };
}

/**
 * Instala Widevine junto al chrome.exe de IAmax (componente Google vÃ­a mirrors).
 * Sirve IAs + streaming. NUNCA tumba el main process.
 */
async function ensureWidevineCdm(chromeExe, opts = {}) {
  try {
    const platform = platformKey(opts.platform);
    if (!chromeExe || !fs.existsSync(chromeExe)) {
      return { ok: false, error: 'chrome exe missing' };
    }
    if (widevinePresent(chromeExe, platform) && !opts.force) {
      return { ok: true, skipped: true, path: path.join(chromeDirFromExe(chromeExe), 'WidevineCdm') };
    }

    if (widevinePromise && !opts.force) {
      return widevinePromise.catch((e) => ({ ok: false, error: String(e?.message || e) }));
    }

    widevinePromise = (async () => {
      const chromeDir = chromeDirFromExe(chromeExe);
      const destRoot = path.join(chromeDir, 'WidevineCdm');
      const sub = widevineSubdir(platform);
      const dllName = widevineDllName(platform);
      const os = require('os');
      const tmpBase = path.join(os.tmpdir(), `iamax-widevine-${process.pid}`);
      const tmpCrx = path.join(tmpBase, 'widevine.crx3');
      const tmpZip = path.join(tmpBase, 'widevine.zip');
      const tmpExtract = path.join(tmpBase, 'extract');

      try {
        fs.mkdirSync(tmpBase, { recursive: true });
      } catch (e) {
        return { ok: false, error: `tmp mkdir: ${e.message}` };
      }

      let version = '4.10.3050.0';
      try {
        const resolved = await resolveWidevineDownloadUrl(platform);
        version = resolved.version;
        console.log('[Browser] Widevine CDM (componente, no Chrome del PC):', resolved.url.slice(0, 90) + 'â€¦');
        await downloadFile(resolved.url, tmpCrx);
      } catch (e) {
        console.warn('[Browser] Widevine download fallÃ³:', e.message);
        try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch { /* ignore */ }
        return { ok: false, error: e.message };
      }

      try {
        const crxBuf = fs.readFileSync(tmpCrx);
        const zipBuf = crx3ToZipBuffer(crxBuf);
        fs.writeFileSync(tmpZip, zipBuf);
        if (fs.existsSync(tmpExtract)) fs.rmSync(tmpExtract, { recursive: true, force: true });
        fs.mkdirSync(tmpExtract, { recursive: true });
        await extractZipSafe(tmpZip, tmpExtract);

        const walk = (dir, acc = []) => {
          if (!fs.existsSync(dir)) return acc;
          for (const name of fs.readdirSync(dir)) {
            const p = path.join(dir, name);
            let st;
            try { st = fs.statSync(p); } catch { continue; }
            if (st.isDirectory()) walk(p, acc);
            else acc.push(p);
          }
          return acc;
        };
        const files = walk(tmpExtract);
        const dllSrc = files.find((f) => path.basename(f).toLowerCase() === dllName.toLowerCase())
          || files.find((f) => /widevinecdm\.(dll|so|dylib)$/i.test(f));
        const manSrc = files.find((f) => path.basename(f).toLowerCase() === 'manifest.json');
        const licSrc = files.find((f) => /license/i.test(path.basename(f)));

        if (!dllSrc) {
          return { ok: false, error: 'widevine dll no encontrada en el componente' };
        }

        if (fs.existsSync(destRoot)) fs.rmSync(destRoot, { recursive: true, force: true });
        const platDir = path.join(destRoot, '_platform_specific', sub);
        fs.mkdirSync(platDir, { recursive: true });
        fs.copyFileSync(dllSrc, path.join(platDir, path.basename(dllSrc)));
        if (manSrc) fs.copyFileSync(manSrc, path.join(destRoot, 'manifest.json'));
        else {
          fs.writeFileSync(path.join(destRoot, 'manifest.json'), JSON.stringify({
            name: 'WidevineCdm',
            description: 'Widevine Content Decryption Module',
            version,
            'x-cdm-codecs': 'vp8,vp9.0,avc1,av01',
            'x-cdm-module-versions': '4',
            'x-cdm-interface-versions': '10',
            'x-cdm-host-versions': '10',
            'x-cdm-min-glue': '1'
          }, null, 2));
        }
        if (licSrc) fs.copyFileSync(licSrc, path.join(destRoot, 'LICENSE'));

        console.log('[Browser] Widevine instalado en Chromium IAmax (IAs+streaming):', destRoot);
        return { ok: true, path: destRoot, version };
      } catch (e) {
        console.warn('[Browser] Widevine install fallÃ³:', e.message);
        return { ok: false, error: e.message };
      } finally {
        try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    })()
      .catch((e) => {
        console.warn('[Browser] Widevine error no fatal:', e?.message || e);
        return { ok: false, error: String(e?.message || e) };
      })
      .finally(() => {
        widevinePromise = null;
      });

    return widevinePromise;
  } catch (e) {
    console.warn('[Browser] Widevine ensure (outer):', e?.message || e);
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Copia Widevine al user-data-dir de la tarjeta (como hace Chrome).
 * Estructura: User Data/WidevineCdm/<version>/_platform_specific/...
 * No usa Chrome del PC del cliente.
 */
function installWidevineIntoUserData(userDataDir, chromeExe, opts = {}) {
  try {
    if (!userDataDir || !chromeExe || !fs.existsSync(chromeExe)) {
      return { ok: false, error: 'paths missing' };
    }
    const platform = platformKey(opts.platform);
    const appWv = path.join(chromeDirFromExe(chromeExe), 'WidevineCdm');
    const dllApp = path.join(appWv, '_platform_specific', widevineSubdir(platform), widevineDllName(platform));
    const manApp = path.join(appWv, 'manifest.json');
    if (!fs.existsSync(dllApp) || !fs.existsSync(manApp)) {
      return { ok: false, error: 'app Widevine missing â€” run ensureWidevineCdm first' };
    }
    let version = '4.10.3050.0';
    try {
      const man = JSON.parse(fs.readFileSync(manApp, 'utf8'));
      if (man.version) version = String(man.version);
    } catch { /* keep default */ }

    const destRoot = path.join(userDataDir, 'WidevineCdm', version);
    const destPlat = path.join(destRoot, '_platform_specific', widevineSubdir(platform));
    fs.mkdirSync(destPlat, { recursive: true });
    fs.copyFileSync(dllApp, path.join(destPlat, widevineDllName(platform)));
    fs.copyFileSync(manApp, path.join(destRoot, 'manifest.json'));
    const licApp = path.join(appWv, 'LICENSE');
    if (fs.existsSync(licApp)) fs.copyFileSync(licApp, path.join(destRoot, 'LICENSE'));
    // .sig si existe junto al dll de la app o en un extract previo
    const sigApp = path.join(appWv, '_platform_specific', widevineSubdir(platform), `${widevineDllName(platform)}.sig`);
    if (fs.existsSync(sigApp)) {
      fs.copyFileSync(sigApp, path.join(destPlat, `${widevineDllName(platform)}.sig`));
    }
    // Metadata mÃ­nima (Chrome la usa para el component)
    const metaDir = path.join(destRoot, '_metadata');
    fs.mkdirSync(metaDir, { recursive: true });
    const verified = path.join(metaDir, 'verified_contents.json');
    if (!fs.existsSync(verified)) {
      fs.writeFileSync(verified, JSON.stringify({ version, installedAt: new Date().toISOString() }, null, 2));
    }
    // Preferencias: contenido protegido permitido
    try {
      const def = path.join(userDataDir, 'Default');
      fs.mkdirSync(def, { recursive: true });
      const prefsPath = path.join(def, 'Preferences');
      let prefs = {};
      if (fs.existsSync(prefsPath)) {
        try { prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8')); } catch { prefs = {}; }
      }
      prefs.profile = prefs.profile || {};
      prefs.profile.default_content_setting_values = prefs.profile.default_content_setting_values || {};
      prefs.profile.default_content_setting_values.protected_media_identifier = 1;
      prefs.profile.content_settings = prefs.profile.content_settings || {};
      prefs.profile.content_settings.exceptions = prefs.profile.content_settings.exceptions || {};
      const now = String(Date.now() * 1000);
      const allow = { setting: 1, last_modified: now, last_visit: '0' };
      const pmi = prefs.profile.content_settings.exceptions.protected_media_identifier || {};
      for (const pattern of [
        'https://*,*',
        'http://*,*',
        'https://*.peacocktv.com,*',
        'https://*.tv.apple.com,*',
        'https://*.netflix.com,*',
        'https://*.disneyplus.com,*'
      ]) {
        pmi[pattern] = { ...(pmi[pattern] || {}), ...allow };
      }
      prefs.profile.content_settings.exceptions.protected_media_identifier = pmi;
      fs.writeFileSync(prefsPath, JSON.stringify(prefs), 'utf8');
    } catch (e) {
      console.warn('[Browser] Widevine prefs perfil:', e.message);
    }
    console.log('[Browser] Widevine en perfil tarjeta:', destRoot);
    return { ok: true, path: destRoot, version };
  } catch (e) {
    console.warn('[Browser] installWidevineIntoUserData:', e.message);
    return { ok: false, error: e.message };
  }
}

function findEdgeExe(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        if (process.platform === 'darwin' && entry.name === 'Microsoft Edge.app') {
          const exe = path.join(full, 'Contents', 'MacOS', 'Microsoft Edge');
          if (fs.existsSync(exe)) return exe;
        }
        stack.push(full);
      } else if (
        (process.platform === 'win32' && entry.name.toLowerCase() === 'msedge.exe')
        || (process.platform === 'linux' && entry.name === 'microsoft-edge')
        || (process.platform === 'linux' && entry.name === 'microsoft-edge-stable')
      ) {
        return full;
      }
    }
  }
  return null;
}

function readIamaxEdgeMeta(installDir) {
  try {
    const file = path.join(installDir, 'IAMAX_EDGE.json');
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return null; }
}

function findExistingIamaxEdge(installDir) {
  const meta = readIamaxEdgeMeta(installDir);
  if (meta?.path && fs.existsSync(meta.path)) return meta.path;
  return findEdgeExe(installDir);
}

function findInstalledEdgeSource() {
  const candidates = [];
  if (process.platform === 'win32') {
    candidates.push(
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      path.join(require('os').homedir(), 'Applications', 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge')
    );
  } else {
    candidates.push('/opt/microsoft/msedge/msedge', '/usr/bin/microsoft-edge-stable', '/usr/bin/microsoft-edge');
  }
  return candidates.find((candidate) => {
    try { return fs.existsSync(candidate); } catch { return false; }
  }) || null;
}

function copyInstalledEdgeIntoIamax(sourceExe, installDir) {
  const extractRoot = path.join(installDir, 'current');
  try { fs.rmSync(extractRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  fs.mkdirSync(extractRoot, { recursive: true });
  if (process.platform === 'win32') {
    const applicationDir = path.dirname(sourceExe);
    fs.cpSync(applicationDir, path.join(extractRoot, 'Application'), { recursive: true, force: true });
  } else if (process.platform === 'darwin') {
    const marker = `${path.sep}Microsoft Edge.app${path.sep}`;
    const idx = sourceExe.indexOf(marker);
    if (idx < 0) throw new Error('No se pudo resolver Microsoft Edge.app');
    const appDir = sourceExe.slice(0, idx + marker.length - 1);
    fs.cpSync(appDir, path.join(extractRoot, 'Microsoft Edge.app'), { recursive: true, force: true });
  } else {
    const sourceRoot = sourceExe.startsWith('/opt/microsoft/msedge/') ? '/opt/microsoft/msedge' : path.dirname(sourceExe);
    fs.cpSync(sourceRoot, path.join(extractRoot, 'msedge'), { recursive: true, force: true });
  }
  const exe = findEdgeExe(extractRoot);
  if (!exe) throw new Error('La copia privada de Edge terminó sin ejecutable');
  return exe;
}

function edgeBinaryVersion(exe) {
  try {
    if (process.platform === 'win32') {
      const versions = fs.readdirSync(path.dirname(exe), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^\d+(\.\d+){3}$/.test(entry.name))
        .map((entry) => entry.name)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      return versions[0] || '';
    }
    if (process.platform === 'darwin') {
      const plist = path.resolve(path.dirname(exe), '..', 'Info.plist');
      if (fs.existsSync(plist)) {
        return execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plist], { encoding: 'utf8' }).trim();
      }
    }
  } catch { /* ignore */ }
  return '';
}

function edgeReleaseTarget() {
  if (process.platform === 'win32') {
    const architecture = process.arch === 'arm64' ? 'arm64' : (process.arch === 'ia32' ? 'x86' : 'x64');
    return { platform: 'Windows', architecture, artifact: 'msi' };
  }
  if (process.platform === 'darwin') {
    return { platform: 'MacOS', architecture: 'universal', artifact: 'pkg' };
  }
  if (process.platform === 'linux' && process.arch === 'x64') {
    return { platform: 'Linux', architecture: 'x64', artifact: 'deb' };
  }
  throw new Error(`Edge IAmax no está disponible para ${process.platform}/${process.arch}`);
}

async function sha256FileAsync(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex').toUpperCase()));
  });
}

async function latestEdgeArtifact() {
  const target = edgeReleaseTarget();
  const products = await fetchJson(EDGE_ENTERPRISE_API);
  const stable = (Array.isArray(products) ? products : []).find((item) => item?.Product === 'Stable');
  const releases = (Array.isArray(stable?.Releases) ? stable.Releases : [])
    .filter((release) => release?.Platform === target.platform && release?.Architecture === target.architecture)
    .sort((a, b) => String(b?.PublishedTime || '').localeCompare(String(a?.PublishedTime || '')));
  for (const release of releases) {
    const artifact = (Array.isArray(release?.Artifacts) ? release.Artifacts : [])
      .find((item) => String(item?.ArtifactName || '').toLowerCase() === target.artifact);
    if (artifact?.Location && artifact?.Hash) return { release, artifact, target };
  }
  throw new Error(`La API oficial no devolvió Edge Stable para ${target.platform}/${target.architecture}`);
}

function extractIamaxEdge(packagePath, extractRoot, target) {
  try { fs.rmSync(extractRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  fs.mkdirSync(extractRoot, { recursive: true });
  if (target.platform === 'Windows') {
    execFileSync('msiexec.exe', ['/a', packagePath, '/qn', `TARGETDIR=${extractRoot}`], {
      windowsHide: true,
      stdio: 'pipe'
    });
  } else if (target.platform === 'MacOS') {
    execFileSync('pkgutil', ['--expand-full', packagePath, extractRoot], { stdio: 'pipe' });
  } else {
    execFileSync('dpkg-deb', ['-x', packagePath, extractRoot], { stdio: 'pipe' });
  }
  const exe = findEdgeExe(extractRoot);
  if (!exe) throw new Error('El paquete oficial se extrajo sin encontrar el ejecutable de Edge');
  if (process.platform !== 'win32') {
    try { execFileSync('chmod', ['+x', exe], { stdio: 'pipe' }); } catch { /* ignore */ }
  }
  clearMacQuarantine(exe);
  return exe;
}

/**
 * Busca chrome.exe de Chrome IAmax (CfT) bajo installDir — nunca Program Files.
 */
function findExistingIamaxChrome(installDir, platform = platformKey()) {
  if (!installDir) return null;
  const roots = [
    installDir,
    path.join(installDir, CHROME_IAMAX_DIR[platform] || 'chrome-iamax-win64'),
    path.join(installDir, 'chrome-iamax'),
    path.join(installDir, 'current')
  ];
  try {
    const metaPath = path.join(installDir, 'IAMAX_CHROME.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta.path && fs.existsSync(meta.path) && /iamax-browser|chrome-iamax/i.test(meta.path)) {
        return meta.path;
      }
    }
  } catch { /* ignore */ }
  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    const exe = findChromeExe(root);
    if (!exe) continue;
    // Rechazar Chrome del sistema por si acaso
    if (/program files|\\google\\chrome\\application\\/i.test(exe)) continue;
    if (/iamax-browser|chrome-iamax|chrome-for-testing|chrome-win/i.test(exe) || /iamax/i.test(exe)) {
      return exe;
    }
    // Si está bajo installDir de IAmax, aceptar
    try {
      if (path.resolve(exe).toLowerCase().startsWith(path.resolve(installDir).toLowerCase())) {
        return exe;
      }
    } catch { /* ignore */ }
  }
  return null;
}

async function downloadIamaxChromeTo(installDir, platform, opts = {}) {
  const plat = platform || platformKey();
  const cftPlat = CFT_PLATFORM[plat] || 'win64';
  const targetSub = CHROME_IAMAX_DIR[plat] || 'chrome-iamax-win64';
  const extractRoot = path.join(installDir, targetSub);
  fs.mkdirSync(installDir, { recursive: true });

  console.log(`[Browser] Resolviendo Chrome IAmax (Chrome for Testing ${cftPlat})…`);
  const data = await fetchJson(CFT_LAST_GOOD);
  const stable = data?.channels?.Stable || data?.channels?.stable;
  if (!stable?.downloads?.chrome) {
    throw new Error('API Chrome for Testing sin canal Stable');
  }
  const asset = (stable.downloads.chrome || []).find((a) => a.platform === cftPlat);
  if (!asset?.url) {
    throw new Error(`No hay descarga Chrome for Testing para ${cftPlat}`);
  }
  const version = String(stable.version || 'unknown');
  const tmpZip = path.join(installDir, `chrome-iamax-${cftPlat}.tmp.zip`);
  try { if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip); } catch { /* ignore */ }

  console.log(`[Browser] Descargando Chrome IAmax ${version}…`);
  await downloadFile(asset.url, tmpZip, opts.onProgress);

  try { fs.rmSync(extractRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  fs.mkdirSync(extractRoot, { recursive: true });
  console.log(`[Browser] Extrayendo Chrome IAmax → ${extractRoot}`);
  extractZip(tmpZip, extractRoot);
  try { fs.unlinkSync(tmpZip); } catch { /* ignore */ }

  if (process.platform !== 'win32') {
    try {
      const exeFound = findChromeExe(extractRoot);
      if (exeFound) execFileSync('chmod', ['+x', exeFound], { stdio: 'pipe' });
    } catch { /* ignore */ }
  }

  const exe = findChromeExe(extractRoot);
  if (!exe) throw new Error('Chrome IAmax extraído sin chrome.exe');
  clearMacQuarantine(exe);

  fs.writeFileSync(
    path.join(installDir, 'IAMAX_CHROME.json'),
    JSON.stringify({
      kind: 'chrome-iamax',
      chromeForTesting: true,
      version,
      platform: cftPlat,
      source: asset.url,
      path: exe,
      installedAt: new Date().toISOString()
    }, null, 2),
    'utf8'
  );
  console.log('[Browser] Chrome IAmax listo (embebido, NO Chrome del PC):', exe);
  return exe;
}

/**
 * Asegura Chrome real (Chrome for Testing) bajo iamax-browser/chrome-iamax — igual que Chromium.
 * Nunca usa Program Files\Google\Chrome.
 */
async function ensureIamaxChrome(opts = {}) {
  const force = Boolean(opts.force);
  const platform = platformKey(opts.platform);
  const installDir = opts.installDir
    || path.join(require('os').homedir(), '.iamax-browser', 'chrome-iamax');

  if (!force) {
    const existing = findExistingIamaxChrome(installDir, platform);
    if (existing) {
      console.log('[Browser] Chrome IAmax ya instalado:', existing);
      return existing;
    }
  }

  if (chromeIamaxInstallPromise && !force) return chromeIamaxInstallPromise;

  chromeIamaxInstallPromise = (async () => {
    console.log(`[Browser] Chrome IAmax no encontrado (${platform}) — descargando (como Chromium)…`);
    if (typeof opts.askPermission === 'function') {
      const allowed = await opts.askPermission({
        type: 'download',
        sizeMb: 180,
        platform,
        kind: 'chrome-iamax'
      });
      if (!allowed) {
        const denied = new Error('USER_DENIED_BROWSER_INSTALL');
        denied.code = 'USER_DENIED';
        throw denied;
      }
    }
    try {
      return await downloadIamaxChromeTo(installDir, platform, opts);
    } catch (error) {
      if (isPermissionError(error) && typeof opts.askPermission === 'function') {
        const retry = await opts.askPermission({ type: 'permission_error', error: error.message });
        if (retry) return downloadIamaxChromeTo(installDir, platform, opts);
      }
      throw error;
    }
  })().finally(() => {
    chromeIamaxInstallPromise = null;
  });

  return chromeIamaxInstallPromise;
}

async function ensureIamaxEdge(opts = {}) {
  const installDir = opts.installDir || path.join(require('os').homedir(), '.iamax-edge');
  if (!opts.force) {
    const existing = findExistingIamaxEdge(installDir);
    if (existing) {
      const source = findInstalledEdgeSource();
      const existingVersion = edgeBinaryVersion(existing);
      const sourceVersion = source ? edgeBinaryVersion(source) : '';
      if (!source || !sourceVersion || sourceVersion === existingVersion) return existing;
      console.log(`[Browser] Actualizando Edge IAmax ${existingVersion || '?'} → ${sourceVersion}`);
    }
  }
  if (edgeInstallPromise && !opts.force) return edgeInstallPromise;
  edgeInstallPromise = (async () => {
    const installedSource = findInstalledEdgeSource();
    if (installedSource) {
      fs.mkdirSync(installDir, { recursive: true });
      const exe = copyInstalledEdgeIntoIamax(installedSource, installDir);
      fs.writeFileSync(path.join(installDir, 'IAMAX_EDGE.json'), JSON.stringify({
        kind: 'edge-iamax',
        source: 'official-installed-binaries-bootstrap',
        sourcePath: installedSource,
        version: edgeBinaryVersion(exe),
        path: exe,
        installedAt: new Date().toISOString()
      }, null, 2), 'utf8');
      return exe;
    }
    if (process.platform === 'win32') {
      throw new Error('Edge IAmax necesita los binarios oficiales de Microsoft Edge disponibles durante la preparación inicial');
    }
    const info = await latestEdgeArtifact();
    if (typeof opts.askPermission === 'function') {
      const allowed = await opts.askPermission({
        type: 'download',
        kind: 'edge-iamax',
        sizeMb: Math.ceil(Number(info.artifact.SizeInBytes || 0) / 1024 / 1024),
        platform: info.target.platform
      });
      if (!allowed) throw new Error('USER_DENIED_BROWSER_INSTALL');
    }
    fs.mkdirSync(installDir, { recursive: true });
    const extension = info.target.artifact;
    const packagePath = path.join(installDir, `edge-iamax.tmp.${extension}`);
    const extractRoot = path.join(installDir, 'current');
    try { if (fs.existsSync(packagePath)) fs.unlinkSync(packagePath); } catch { /* ignore */ }
    await downloadFile(info.artifact.Location, packagePath, opts.onProgress);
    const actualHash = await sha256FileAsync(packagePath);
    if (actualHash !== String(info.artifact.Hash).toUpperCase()) {
      try { fs.unlinkSync(packagePath); } catch { /* ignore */ }
      throw new Error('SHA-256 inválido en el paquete oficial de Edge');
    }
    const exe = extractIamaxEdge(packagePath, extractRoot, info.target);
    try { fs.unlinkSync(packagePath); } catch { /* ignore */ }
    fs.writeFileSync(path.join(installDir, 'IAMAX_EDGE.json'), JSON.stringify({
      kind: 'edge-iamax',
      version: info.release.ProductVersion,
      platform: info.target.platform,
      architecture: info.target.architecture,
      source: info.artifact.Location,
      sha256: actualHash,
      path: exe,
      installedAt: new Date().toISOString()
    }, null, 2), 'utf8');
    return exe;
  })().finally(() => { edgeInstallPromise = null; });
  return edgeInstallPromise;
}

module.exports = {
  ensureIamaxEdge,
  ensureIamaxChrome,
  ensureStandardChromium,
  downloadStandardChromiumTo,
  findExistingStandardChromium,
  findExistingIamaxChrome,
  findExistingIamaxEdge,
  findEdgeExe,
  findInstalledEdgeSource,
  findChromeExe,
  platformKey,
  clearMacQuarantine,
  clearChromiumProfileLocks,
  ensureWidevineCdm,
  widevinePresent,
  installWidevineIntoUserData,
  STANDARD_PLATFORM_DIR,
};
