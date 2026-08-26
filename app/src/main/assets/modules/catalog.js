(function initializeIAmaxModuleCatalog(scope) {
  const modules = Object.freeze({
    core: Object.freeze({ id: "core", required: true }),
    session: Object.freeze({ id: "session", required: true }),
    injector: Object.freeze({ id: "injector", required: true }),
    shield: Object.freeze({ id: "shield", required: true }),
    "clear-cache": Object.freeze({ id: "clear-cache", required: false }),
    "streaming-clean": Object.freeze({ id: "streaming-clean", required: false }),
    "chatgpt-diagnostics": Object.freeze({ id: "chatgpt-diagnostics", required: false })
  });
  scope.IAMAX_MODULE_CATALOG = modules;
  scope.IAMAX_REQUIRED_MODULES = Object.freeze(
    Object.values(modules).filter((entry) => entry.required).map((entry) => entry.id)
  );
})(globalThis);
