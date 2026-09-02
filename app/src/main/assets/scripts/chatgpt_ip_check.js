// chatgpt_ip_check.js
(function() {
  if (window.self !== window.top) return; // Only run in top frame

  const btn = document.createElement("button");
  btn.innerText = "🌐 Verificar IP Proxy";
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
    btn.innerText = "🔄 Verificando...";
    btn.style.opacity = "0.8";
    btn.disabled = true;
    try {
      // Usamos una API pública sencilla que devuelve la IP en JSON
      const res = await fetch("https://api.ipify.org?format=json");
      const data = await res.json();
      
      btn.innerText = "✅ IP Actual: " + data.ip;
      btn.style.backgroundColor = "#208a68"; // Un verde un poco más oscuro
      btn.style.opacity = "1";
      
      setTimeout(() => {
        btn.innerText = "🌐 Verificar IP Proxy";
        btn.style.backgroundColor = "#10a37f";
        btn.disabled = false;
      }, 6000);
    } catch (err) {
      btn.innerText = "❌ Error de Red / Proxy";
      btn.style.backgroundColor = "#dc3545"; // Rojo
      btn.style.opacity = "1";
      
      setTimeout(() => {
        btn.innerText = "🌐 Verificar IP Proxy";
        btn.style.backgroundColor = "#10a37f";
        btn.disabled = false;
      }, 5000);
    }
  });

  // Esperar a que el body exista
  const interval = setInterval(() => {
    if (document.body) {
      document.body.appendChild(btn);
      clearInterval(interval);
    }
  }, 100);
})();
