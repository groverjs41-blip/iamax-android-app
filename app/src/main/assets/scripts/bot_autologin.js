// Auto-acceso al Bot WhatsApp desde IAmax (extension / iframe)
(function () {
  const BOT_HOST_PATTERN = /iamaxbackenv2|botiamax-production/i;
  if (!BOT_HOST_PATTERN.test(window.location.hostname)) return;

  function redirectWithToken(token) {
    if (!token) return;
    const redirect = "/client/live-chat" + (window.location.search || "?embedded=1");
    const params = new URLSearchParams({ token, redirect });
    window.location.replace(`/auth/bridge?${params.toString()}`);
  }

  window.addEventListener("message", (event) => {
    if (event.data?.type === "IAMAX_BOT_TOKEN" && event.data.token) {
      redirectWithToken(event.data.token);
    }
  });

  if (window.parent !== window) {
    window.parent.postMessage({ type: "IAMAX_BOT_TOKEN_REQUEST" }, "*");
  }

  const urlToken = new URLSearchParams(window.location.search).get("token");
  if (urlToken && (window.location.pathname === "/" || window.location.pathname === "/login")) {
    redirectWithToken(urlToken);
    return;
  }

  function checkLoginInputs() {
    const emailInput = document.querySelector('input[type="email"]');
    const passwordInput = document.querySelector('input[type="password"]');
    const submitBtn = document.querySelector('button[type="submit"]');
    return emailInput && passwordInput && submitBtn;
  }

  function setNativeValue(element, value) {
    const valueSetter = Object.getOwnPropertyDescriptor(element, "value")?.set;
    const prototype = Object.getPrototypeOf(element);
    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

    if (valueSetter && prototypeValueSetter && valueSetter !== prototypeValueSetter) {
      prototypeValueSetter.call(element, value);
    } else if (valueSetter) {
      valueSetter.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function attemptAutoLogin() {
    if (!checkLoginInputs()) return;

    try {
      const session = await chrome.storage.session.get(["botEmail", "botPassword"]);
      const local = await chrome.storage.local.get(["botEmail", "botPassword", "ownerToken"]);
      const botEmail = session.botEmail || local.botEmail;
      const botPassword = session.botPassword || local.botPassword;

      if (local.botEmail || local.botPassword) {
        await chrome.storage.session.set({
          botEmail: botEmail || "",
          botPassword: botPassword || ""
        });
        await chrome.storage.local.remove(["botEmail", "botPassword"]);
      }

      if (local.ownerToken) {
        redirectWithToken(local.ownerToken);
        return;
      }

      if (botEmail && botPassword) {
        const emailInput = document.querySelector('input[type="email"]');
        const passwordInput = document.querySelector('input[type="password"]');
        const submitBtn = document.querySelector('button[type="submit"]');

        setNativeValue(emailInput, botEmail);
        setNativeValue(passwordInput, botPassword);

        setTimeout(() => submitBtn.click(), 500);
      }
    } catch (error) {
      console.warn("[IAmax] Error al intentar autologin en el bot", error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attemptAutoLogin);
  } else {
    attemptAutoLogin();
  }

  const observer = new MutationObserver(() => {
    if (checkLoginInputs()) {
      attemptAutoLogin();
      observer.disconnect();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 15000);
})();