(function initializeIAmaxModuleClient(scope) {
  if (scope.iamaxModules) return;
  function requestPolicy() {
    return new Promise((resolve) => {
      try {
        const runtime = scope.iamaxChrome?.runtime || scope.chrome?.runtime;
        if (!runtime?.sendMessage) return resolve({ managed: false, modules: [] });
        runtime.sendMessage({ type: "GET_PROFILE_MODULES" }, (response) => {
          if (scope.chrome?.runtime?.lastError) return resolve({ managed: false, modules: [] });
          resolve(response || { managed: false, modules: [] });
        });
      } catch (e) {
        resolve({ managed: false, modules: [] });
      }
    });
  }
  scope.iamaxModules = Object.freeze({
    getPolicy: requestPolicy,
    async isEnabled(moduleId) {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const policy = await requestPolicy();
        if (policy.managed) return Boolean(policy.modules?.includes(moduleId));
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return false;
    }
  });
})(globalThis);
