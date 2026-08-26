(() => {
  function getAssetLink(target) {
    const link = target?.closest?.('a[href*="assets.grok.com/"]');
    if (!link?.href) return null;
    try {
      const url = new URL(link.href);
      return url.hostname === 'assets.grok.com' ? url.href : null;
    } catch (error) {
      return null;
    }
  }

  document.addEventListener('click', event => {
    const assetUrl = getAssetLink(event.target);
    if (!assetUrl) return;
    event.preventDefault();
    event.stopPropagation();
    const filename = decodeURIComponent(new URL(assetUrl).pathname.split('/').pop() || 'archivo-grok');
    chrome.runtime.sendMessage({ type: 'DOWNLOAD_GROK_ASSET', url: assetUrl, filename });
  }, true);
})();
