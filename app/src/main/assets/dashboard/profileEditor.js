import { FINGERPRINT_DATA } from './fingerprint_data.js';

let currentOS = 'Windows';

export function initProfileEditor() {
  // Tabs
  document.querySelectorAll('.profile-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.profile-nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      const sectionId = item.getAttribute('data-section');
      document.querySelectorAll('.profile-panel').forEach(p => p.classList.remove('active'));
      document.getElementById(sectionId)?.classList.add('active');
    });
  });

  // More Huellas toggle
  const moreToggle = document.getElementById('moreToggle');
  const moreSection = document.getElementById('moreSection');
  if (moreToggle && moreSection) {
    moreToggle.addEventListener('click', () => {
      moreSection.classList.toggle('open');
      moreToggle.textContent = moreSection.classList.contains('open') ? 'Menos huellas' : 'Más huellas';
    });
  }

  // Seg groups
  document.querySelectorAll('.seg-group').forEach(group => {
    group.querySelectorAll('.seg').forEach(btn => {
      btn.addEventListener('click', () => {
        group.querySelectorAll('.seg').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Handle special groups
        if (group.id === 'langGroup') {
          document.getElementById('langCustomRow').style.display = btn.getAttribute('data-val') === 'custom' ? 'flex' : 'none';
        }
        if (group.classList.contains('proxy-type-group')) {
          const type = btn.getAttribute('data-type');
          document.getElementById('proxyFields').style.display = type === 'custom' ? 'block' : 'none';
          const savedFields = document.getElementById('savedProxyFields');
          if (savedFields) {
            savedFields.style.display = type === 'saved' ? 'block' : 'none';
          }
        }
        if (group.id === 'webrtcGroup') {
          document.getElementById('webrtcModeSelect').value = btn.getAttribute('data-val');
        }
        
        buildSummary();
      });
    });
  });

  document.getElementById('osSelect')?.addEventListener('change', (e) => {
    currentOS = e.target.value;
    onOSChange(currentOS);
  });

  document.getElementById('osSubVersionSelect')?.addEventListener('change', () => {
    updateUA();
  });

  document.getElementById('refreshUA')?.addEventListener('click', () => {
    updateUA();
  });

  document.getElementById('uaVersion')?.addEventListener('change', () => {
    updateUA();
  });

  document.getElementById('randWebglBtn')?.addEventListener('click', () => {
    const arr = FINGERPRINT_DATA.webgl[currentOS] || [];
    if (arr.length) {
      const item = arr[Math.floor(Math.random() * arr.length)];
      const vendorSel = document.getElementById('webglVendorSel');
      if (vendorSel) {
        for (let i = 0; i < vendorSel.options.length; i++) {
          if (vendorSel.options[i].text === item.vendor) {
            vendorSel.selectedIndex = i;
            break;
          }
        }
      }
      const rendererInp = document.getElementById('webglRendererInp');
      if (rendererInp) rendererInp.value = item.renderer;
      buildSummary();
    }
  });

  document.getElementById('webglVendorSel')?.addEventListener('change', (e) => {
    const list = FINGERPRINT_DATA.webgl[currentOS] || [];
    const item = list[e.target.value];
    if (item) {
      const rendererInp = document.getElementById('webglRendererInp');
      if (rendererInp) rendererInp.value = item.renderer;
    }
    buildSummary();
  });

  document.getElementById('updateFpSummary')?.addEventListener('click', buildSummary);

  document.querySelectorAll('.fp-input').forEach(el => {
    el.addEventListener('change', buildSummary);
    el.addEventListener('input', buildSummary);
  });

  
  // Mostrar/ocultar caja de sincronización según Personalizado/Global
  const syncGroup = document.getElementById('syncGroup');
  const syncBox = document.getElementById('syncBox');
  if (syncGroup && syncBox) {
    syncGroup.querySelectorAll('.seg').forEach(btn => {
      btn.addEventListener('click', () => {
        syncBox.style.display = btn.getAttribute('data-val') === 'custom' ? 'block' : 'none';
      });
    });
  }

  // Mostrar/ocultar caja de extensión
  const extGroup = document.getElementById('extGroup');
  const extBox = document.getElementById('extBox');
  if (extGroup && extBox) {
    extGroup.querySelectorAll('.seg').forEach(btn => {
      btn.addEventListener('click', () => {
        extBox.style.display = btn.getAttribute('data-val') === 'enable' ? 'block' : 'none';
      });
    });
  }

  // Quitar tag de lista blanca
  document.querySelectorAll('.tag-x').forEach(x => {
    x.addEventListener('click', () => x.closest('.tag').remove());
  });

  onOSChange('Windows');
}

function generateUA(os, version, specificOsStr = null) {
  const cfg = FINGERPRINT_DATA.userAgents[os];
  if (!cfg) return '';
  const osStr = (specificOsStr && specificOsStr !== 'all') ? specificOsStr : cfg.osStrings[Math.floor(Math.random() * cfg.osStrings.length)];
  if (os === 'iOS') {
    return cfg.template.replace('{OS}', osStr).replace('{SAFARI}', version);
  }
  const fullVer = `${version}.0.${Math.floor(Math.random() * 3000) + 6000}.${Math.floor(Math.random() * 200)}`;
  return cfg.template.replace('{OS}', osStr).replace('{VER}', fullVer);
}


function getOSLabel(osStr, os) {
  if (os === 'Windows') {
    if (osStr.includes('11.0')) return 'Windows 11';
    if (osStr.includes('10.0')) return 'Windows 10';
    if (osStr.includes('6.3')) return 'Windows 8.1';
    if (osStr.includes('6.2')) return 'Windows 8';
    if (osStr.includes('6.1')) return 'Windows 7';
    return 'Windows';
  } else if (os === 'macOS') {
    const match = osStr.match(/Mac OS X (\d+_\d+)/);
    return match ? `macOS ${match[1].replace('_', '.')}` : 'macOS';
  } else if (os === 'Android') {
    const match = osStr.match(/Android (\d+)/);
    const parts = osStr.split(';');
    const model = parts.length > 2 ? parts[2].trim() : '';
    return match ? `Android ${match[1]} ${model ? '(' + model + ')' : ''}` : 'Android';
  } else if (os === 'iOS') {
    const match = osStr.match(/OS (\d+_\d+)/);
    return match ? `iOS ${match[1].replace('_', '.')}` : 'iOS';
  }
  return osStr;
}

function populateOSVersions(os) {
  const sel = document.getElementById('osSubVersionSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="all">Todas las versiones</option>';
  const cfg = FINGERPRINT_DATA.userAgents[os];
  if (cfg && cfg.osStrings) {
    const added = new Set();
    cfg.osStrings.forEach(osStr => {
      const label = getOSLabel(osStr, os);
      if (!added.has(label)) {
        added.add(label);
        const opt = document.createElement('option');
        opt.value = osStr;
        opt.textContent = label;
        sel.appendChild(opt);
      }
    });
  }
}

function updateUA() {
  const uaVer = document.getElementById('uaVersion')?.value || 'all';
  const osVer = document.getElementById('osSubVersionSelect')?.value || 'all';
  const cfg = FINGERPRINT_DATA.userAgents[currentOS];
  if (!cfg) return;
  
  const rv = uaVer === 'all' 
    ? cfg.versions[Math.floor(Math.random() * cfg.versions.length)]
    : uaVer;
    
  document.getElementById('userAgentInput').value = generateUA(currentOS, rv, osVer);
  buildSummary();
}

function populateUAVersions(os) {
  const sel = document.getElementById('uaVersion');
  if (!sel) return;
  sel.innerHTML = '<option value="all">Todas las versiones</option>';
  const cfg = FINGERPRINT_DATA.userAgents[os];
  if (cfg) {
    cfg.versions.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = os === 'iOS' ? `iOS ${v}` : `UA ${v}`;
      sel.appendChild(opt);
    });
  }
}

function populateWebGL(os) {
  const list = FINGERPRINT_DATA.webgl[os] || [];
  const vendorSel = document.getElementById('webglVendorSel');
  const rendererInp = document.getElementById('webglRendererInp');
  if (!vendorSel) return;

  vendorSel.innerHTML = '';
  list.forEach((item, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = item.vendor;
    vendorSel.appendChild(opt);
  });
  if (list[0] && rendererInp) {
    rendererInp.value = list[0].renderer;
  }
}

function populateFonts(os) {
  const fonts = FINGERPRINT_DATA.fonts[os] || [];
  const p = document.getElementById('fontsPreviewText');
  if (p) {
    p.textContent = `${fonts.slice(0,3).join(', ')}, ${fonts[3] || ''}... ${fonts.length} en total`;
  }
}

function onOSChange(os) {
  populateUAVersions(os);
  populateOSVersions(os);
  populateWebGL(os);
  populateFonts(os);
  const uaInp = document.getElementById('userAgentInput');
  if (uaInp && !uaInp.dataset.manualOverride) {
    updateUA();
  } else {
    buildSummary();
  }
}

function buildSummary() {
  const activeText = (sel) => {
    const el = document.querySelector(`${sel} .seg.active, ${sel} .os-btn.active`);
    return el ? el.textContent.trim() : '-';
  };

  const data = {
    'Sistema Operativo': document.getElementById('osSelect')?.value || currentOS,
    'User Agent': document.getElementById('userAgentInput')?.value || '',
    'Proxy': activeText('.proxy-type-group'),
    'WebGL': document.getElementById('webglRendererInp')?.value || '-',
    'WebRTC': activeText('#webrtcGroup'),
    'Canvas': activeText('[data-key="canvas"]')
  };

  const list = document.getElementById('summaryList');
  if (!list) return;
  list.innerHTML = '';
  for (const [k, v] of Object.entries(data)) {
    const div = document.createElement('div');
    div.className = 'summary-item';
    div.innerHTML = `<span class="k">${k}</span><span class="v">${v}</span>`;
    list.appendChild(div);
  }
}

export function getProfileData() {
  const config = {};
  
  // OS
  const osSelect = document.getElementById('osSelect');
  if (osSelect) config.os = osSelect.value;

  // Todos los seg-groups (fp-group)
  document.querySelectorAll('.fp-group').forEach(group => {
    const key = group.getAttribute('data-key');
    const active = group.querySelector('.seg.active');
    if (key && active) {
      config[key] = active.getAttribute('data-val');
    }
  });

  // Inputs normales (fp-input)
  document.querySelectorAll('.fp-input').forEach(input => {
    const key = input.getAttribute('data-key');
    if (key) {
      config[key] = input.value;
    }
  });

  
  // Checkboxes (fp-check)
  document.querySelectorAll('.fp-check').forEach(input => {
    const key = input.getAttribute('data-key');
    if (key) {
      config[key] = input.checked;
    }
  });

  // WebGL extra
  const webglVendor = document.getElementById('webglVendorSel');
  if (webglVendor) config.webgl_vendor = webglVendor.options[webglVendor.selectedIndex]?.text;
  config.webgl_renderer = document.getElementById('webglRendererInp')?.value;

  return config;
}

export function setProfileData(card) {
  // Set OS first
  const config = card.fingerprint_config || {};
  if (config.os) {
    document.querySelectorAll('.os-btn').forEach(btn => {
      if (btn.textContent.trim() === config.os) {
        btn.click();
      }
    });
  }

  // Restore proxy panel visibility
  const proxyHost = document.getElementById('proxyHostInput')?.value;
  if (proxyHost) {
    document.querySelector('.proxy-type-group [data-type="custom"]')?.click();
  } else {
    document.querySelector('.proxy-type-group [data-type="none"]')?.click();
  }

  // Restore Language (custom or auto)
  const lang = document.getElementById('acceptLanguageInput')?.value;
  if (lang) {
    document.querySelector('#langGroup [data-val="custom"]')?.click();
  } else {
    document.querySelector('#langGroup [data-val="auto"]')?.click();
  }

  // Set all fp-groups
  Object.keys(config).forEach(key => {
    const group = document.querySelector(`.fp-group[data-key="${key}"]`);
    if (group) {
      const btn = group.querySelector(`[data-val="${config[key]}"]`);
      if (btn) btn.click();
    }
  });

  
  // Set all fp-check
  document.querySelectorAll('.fp-check').forEach(input => {
    const key = input.getAttribute('data-key');
    if (key && config[key] !== undefined) {
      input.checked = config[key];
    }
  });

  // Restore syncBox visibility
  const syncBox = document.getElementById('syncBox');
  if (syncBox && config.adv_sync_mode === 'custom') {
    syncBox.style.display = 'block';
  } else if (syncBox) {
    syncBox.style.display = 'none';
  }

  // Restore extBox visibility
  const extBox = document.getElementById('extBox');
  if (extBox && config.adv_extensions === 'enable') {
    extBox.style.display = 'block';
  } else if (extBox) {
    extBox.style.display = 'none';
  }

  // Set all fp-inputs
  Object.keys(config).forEach(key => {
    const input = document.querySelector(`.fp-input[data-key="${key}"]`);
    if (input) input.value = config[key];
  });

  // Webgl manual
  const webglVendor = document.getElementById('webglVendorSel');
  if (webglVendor && config.webgl_vendor) {
    for (let i = 0; i < webglVendor.options.length; i++) {
      if (webglVendor.options[i].text === config.webgl_vendor) {
        webglVendor.selectedIndex = i;
        break;
      }
    }
  }
  const renderer = document.getElementById('webglRendererInp');
  if (renderer && config.webgl_renderer) {
    renderer.value = config.webgl_renderer;
  }
  
  // Set User Agent dataset to avoid auto-override during edit
  const uaInp = document.getElementById('userAgentInput');
  if (uaInp) {
    if (card.user_agent) {
       uaInp.dataset.manualOverride = "true";
       uaInp.value = card.user_agent;
    } else {
       delete uaInp.dataset.manualOverride;
    }
  }

  buildSummary();
}
