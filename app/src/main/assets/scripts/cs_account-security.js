(function () {
  const IAMAX_OWNER_MODE = __IAMAX_OWNER_MODE__;
  if (IAMAX_OWNER_MODE || window.__iamaxAccountSecurityShieldV1) return;
  window.__iamaxAccountSecurityShieldV1 = true;
  const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const loginRoute = () => /signin|sign-in|login|identifier|challenge|oauth|consent|accountchooser|totp|otp|2fa|mfa|verification/i.test(location.pathname + location.search);
  const riskyUrl = () => {
    const host = normalize(location.hostname);
    const route = normalize(location.pathname + location.search + location.hash);
    if (/^myaccount\.google\./.test(host)) return true;
    if (/accounts\.google\./.test(host) && loginRoute()) return /recovery|passkey|security-checkup|manageaccount/i.test(route);
    return /(?:^|\/)(?:account|settings|profile|preferences)(?:\/|$)/.test(route) && /password|security|recovery|email|phone|passkey|two.?factor|2fa|mfa|delete|remove.?account|billing|payment/.test(route);
  };
  const riskyLabel = (element) => {
    const label = normalize([element?.textContent,element?.getAttribute?.("aria-label"),element?.getAttribute?.("title"),element?.getAttribute?.("href")].filter(Boolean).join(" ").replace(/\s+/g," "));
    return /cambiar (?:el )?(?:correo|email|contrasena)|change (?:email|password)|correo de recuperacion|recovery (?:email|phone)|telefono de recuperacion|security settings|configuracion de seguridad|manage (?:your )?account|administrar (?:tu )?cuenta|passkeys?|claves? de acceso|delete (?:your )?account|eliminar (?:tu )?cuenta|two.?step verification|verificacion en 2 pasos|billing|payment methods?|metodos? de pago/.test(label);
  };
  function showBlocked() {
    if (document.getElementById("iamax-security-blocked")) return;
    const box=document.createElement("div"); box.id="iamax-security-blocked";
    box.innerHTML='<div><span>IAMAX SECURITY</span><h1>Configuración protegida</h1><p>Esta sección puede cambiar el correo, la contraseña o la recuperación de la cuenta compartida. Sólo el owner puede administrarla.</p><button type="button">Volver a la herramienta</button></div>';
    const style=document.createElement("style"); style.textContent='#iamax-security-blocked{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:radial-gradient(circle at 50% 10%,#32105b,#050108 55%);color:#fff;font-family:Inter,Segoe UI,sans-serif;padding:24px}#iamax-security-blocked>div{max-width:560px;padding:34px;border:1px solid #a855f7;border-radius:22px;background:#0b0312;box-shadow:0 0 60px #7e22ce66;text-align:center}#iamax-security-blocked span{color:#67e8f9;font-weight:900;letter-spacing:.16em;font-size:12px}#iamax-security-blocked h1{font-size:32px;margin:12px 0}#iamax-security-blocked p{color:#d8b4fe;line-height:1.6}#iamax-security-blocked button{margin-top:15px;padding:12px 20px;border:1px solid #67e8f9;border-radius:12px;color:#fff;background:linear-gradient(90deg,#581c87,#a21caf);font-weight:900;cursor:pointer}';
    (document.documentElement||document).append(style,box);
    box.querySelector("button").onclick=()=>history.length>1?history.back():(location.href=location.protocol+'//'+location.host+'/');
  }
  function protect(){if(riskyUrl())showBlocked();document.querySelectorAll("a,button,[role='button'],[role='menuitem']").forEach((el)=>{if(riskyLabel(el)){el.setAttribute("data-iamax-security-blocked","1");el.style.setProperty("display","none","important");}});}
  document.addEventListener("click",(event)=>{const control=event.target?.closest?.("a,button,[role='button'],[role='menuitem']");if(!control||!riskyLabel(control))return;event.preventDefault();event.stopImmediatePropagation();showBlocked();},true);
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",protect,{once:true});else protect();
  const installObserver=()=>{if(!document.documentElement)return;let scheduled=false;new MutationObserver(()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;protect();});}).observe(document.documentElement,{childList:true,subtree:true});};
  if(document.documentElement)installObserver();else document.addEventListener("DOMContentLoaded",installObserver,{once:true});
  window.addEventListener("popstate",protect);
})();
