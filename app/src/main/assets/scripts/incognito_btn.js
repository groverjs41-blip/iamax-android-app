// Crear el botón flotante
const btn = document.createElement("button");
btn.innerText = "🧹 Borrar caché";
btn.id = "incognito-restart-btn";

// Estilos del botón
btn.style.cssText = `
  position: fixed; 
  bottom: 30px; 
  left: 30px; 
  z-index: 999999; 
  padding: 12px 18px; 
  background-color: #ff3333; 
  color: #ffffff; 
  border: 1px solid #cc0000; 
  border-radius: 50px; 
  cursor: pointer; 
  font-family: sans-serif; 
  font-size: 14px;
  font-weight: bold;
  box-shadow: 0 4px 6px rgba(0,0,0,0.3);
  transition: transform 0.2s;
`;

// Efecto al pasar el mouse
btn.onmouseover = () => btn.style.transform = "scale(1.05)";
btn.onmouseout = () => btn.style.transform = "scale(1)";

// Acción al hacer clic: enviar mensaje al background script con la URL actual
btn.onclick = () => {
  btn.innerText = "⏳ Borrando...";
  chrome.runtime.sendMessage({ 
    type: "RELOAD_INCOGNITO", 
    url: window.location.href 
  }, (res) => {
    if (res && res.success) {
      btn.innerText = "✅ Listo";
      setTimeout(() => { btn.innerText = "🧹 Borrar caché"; }, 2000);
    } else {
      btn.innerText = "❌ Error";
      setTimeout(() => { btn.innerText = "🧹 Borrar caché"; }, 2000);
    }
  });
};

// Evitar inyectar múltiples veces
if (!document.getElementById("incognito-restart-btn")) {
  if (document.documentElement) {
    document.documentElement.appendChild(btn);
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      document.documentElement.appendChild(btn);
    });
  }
}
