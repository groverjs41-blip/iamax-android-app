// Crear el botón flotante
const btn = document.createElement("button");
btn.innerText = "🕶️ Reiniciar";
btn.id = "incognito-restart-btn";

// Estilos del botón
btn.style.cssText = `
  position: fixed; 
  bottom: 20px; 
  right: 20px; 
  z-index: 999999; 
  padding: 12px 18px; 
  background-color: #202124; 
  color: #ffffff; 
  border: 1px solid #5f6368; 
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
  chrome.runtime.sendMessage({ 
    type: "RELOAD_INCOGNITO", 
    url: window.location.href 
  });
};

// Evitar inyectar múltiples veces
if (!document.getElementById("incognito-restart-btn")) {
  document.body.appendChild(btn);
}
