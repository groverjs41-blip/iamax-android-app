// Visible only for owner/support sessions. Clients do not see this technical button.
(async function() {
  if (window.self !== window.top) return;
  if (!await globalThis.iamaxModules?.isEnabled?.("chatgpt-diagnostics")) return;

  const ownerState = await globalThis.chrome?.storage?.local
    ?.get(["ownerToken", "iamax_admin_token"])
    .catch(() => ({}));

  if (!ownerState?.ownerToken && !ownerState?.iamax_admin_token) {
    return;
  }

  const btn = document.createElement("button");
  btn.innerText = "Verificar IP Proxy";
  btn.style.position = "fixed";
  btn.style.bottom = "20px";
  btn.style.right = "20px";
  btn.style.zIndex = "999999";
  btn.style.padding = "10px 15px";
  btn.style.backgroundColor = "#10a37f";
  btn.style.color = "white";
  btn.style.border = "none";
  btn.style.borderRadius = "8px";
  btn.style.fontWeight = "bold";
  btn.style.cursor = "pointer";
  btn.style.boxShadow = "0 4px 6px rgba(0,0,0,0.2)";
  btn.style.fontFamily = "system-ui, sans-serif";
  btn.style.transition = "all 0.3s ease";

  btn.addEventListener("mouseover", () => {
    btn.style.transform = "scale(1.05)";
  });
  btn.addEventListener("mouseout", () => {
    btn.style.transform = "scale(1)";
  });

  btn.addEventListener("click", async () => {
    btn.innerText = "Verificando...";
    btn.style.opacity = "0.8";
    btn.disabled = true;
    try {
      const res = await fetch("https://api.ipify.org?format=json", { cache: "no-store" });
      const data = await res.json();
      const payload = {
        ip: data.ip || "",
        checkedAt: Date.now(),
        ok: Boolean(data.ip)
      };

      await globalThis.chrome?.storage?.local?.set({ iamaxLastProxyIpCheck: payload });
      btn.innerText = "IP actual: " + (data.ip || "desconocida");
      btn.style.backgroundColor = "#208a68";
      btn.style.opacity = "1";

      setTimeout(() => {
        btn.innerText = "Verificar IP Proxy";
        btn.style.backgroundColor = "#10a37f";
        btn.disabled = false;
      }, 6000);
    } catch (error) {
      const payload = {
        ip: "",
        checkedAt: Date.now(),
        ok: false,
        error: error?.message || "Error de red/proxy"
      };

      await globalThis.chrome?.storage?.local?.set({ iamaxLastProxyIpCheck: payload });
      btn.innerText = "Error de red/proxy";
      btn.style.backgroundColor = "#dc3545";
      btn.style.opacity = "1";

      setTimeout(() => {
        btn.innerText = "Verificar IP Proxy";
        btn.style.backgroundColor = "#10a37f";
        btn.disabled = false;
      }, 5000);
    }
  });

  const interval = setInterval(() => {
    if (document.body) {
      document.body.appendChild(btn);
      clearInterval(interval);
    }
  }, 100);
})();
