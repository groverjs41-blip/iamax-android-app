(function initializeIAmaxModuleManager(scope) {
  const STORAGE_KEY = "iamaxProfileModulePolicies";
  const policies = new Map();
  let restored = false;

  function normalizeModules(requested = []) {
    const known = scope.IAMAX_MODULE_CATALOG || {};
    const enabled = new Set(scope.IAMAX_REQUIRED_MODULES || []);
    for (const id of Array.isArray(requested) ? requested : []) {
      if (Object.prototype.hasOwnProperty.call(known, id)) enabled.add(id);
    }
    return [...enabled];
  }

  async function restore() {
    if (restored) return;
    const stored = await chrome.storage.session.get(STORAGE_KEY).catch(() => ({}));
    for (const [cardId, ids] of Object.entries(stored[STORAGE_KEY] || {})) {
      policies.set(String(cardId), normalizeModules(ids));
    }
    restored = true;
  }

  async function configureCard(cardId, requested) {
    await restore();
    if (cardId === undefined || cardId === null || cardId === "") throw new Error("cardId requerido");
    const modules = normalizeModules(requested);
    policies.set(String(cardId), modules);
    await chrome.storage.session.set({ [STORAGE_KEY]: Object.fromEntries(policies) });
    return modules;
  }

  async function getForCard(cardId) {
    await restore();
    return cardId === undefined || cardId === null ? [] : (policies.get(String(cardId)) || []);
  }

  scope.iamaxModuleManager = Object.freeze({ configureCard, getForCard, restore });
})(globalThis);
