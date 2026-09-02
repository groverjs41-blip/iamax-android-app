(() => {
const injectGeminiTools = () => {
    if (!window.location.hostname.includes("gemini.google.com")) return;

    // Evitar inyectar dos veces
    if (document.getElementById("iamax-gemini-tools")) return;

    const container = document.createElement("div");
    container.id = "iamax-gemini-tools";
    container.style.position = "fixed";
    container.style.bottom = "20px";
    container.style.right = "20px";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "10px";
    container.style.zIndex = "999999";

    const createBtn = (text, url, color) => {
        const btn = document.createElement("button");
        btn.textContent = text;
        btn.style.backgroundColor = color;
        btn.style.color = "white";
        btn.style.border = "none";
        btn.style.padding = "12px 20px";
        btn.style.borderRadius = "25px";
        btn.style.cursor = "pointer";
        btn.style.fontFamily = "sans-serif";
        btn.style.fontWeight = "bold";
        btn.style.fontSize = "14px";
        btn.style.boxShadow = "0 4px 15px rgba(0,0,0,0.4)";
        btn.style.transition = "transform 0.2s, box-shadow 0.2s";
        
        btn.onmouseover = () => {
            btn.style.transform = "translateY(-2px)";
            btn.style.boxShadow = "0 6px 20px rgba(0,0,0,0.6)";
        };
        btn.onmouseout = () => {
            btn.style.transform = "translateY(0)";
            btn.style.boxShadow = "0 4px 15px rgba(0,0,0,0.4)";
        };

        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            chrome.runtime.sendMessage({ type: "OPEN_TOOL_WINDOW", url: url, useParentSession: true });
        };

        return btn;
    };

    const flowBtn = createBtn("\uD83C\uDF4C Abrir NanoBanana", "https://labs.google/fx/tools/flow", "#f39c12");
    const notebookBtn = createBtn("\uD83D\uDCD8 Abrir NotebookLM", "https://notebooklm.google.com/", "#3498db");

    container.appendChild(flowBtn);
    container.appendChild(notebookBtn);

    document.body.appendChild(container);
};

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectGeminiTools);
} else {
    injectGeminiTools();
}

// Inyectar de nuevo si Google recrea el body (aplicaciones SPA)
const observer = new MutationObserver(() => {
    if (!document.getElementById("iamax-gemini-tools") && document.body) {
        injectGeminiTools();
    }
});
observer.observe((document.documentElement || document), { childList: true, subtree: true });

})();
