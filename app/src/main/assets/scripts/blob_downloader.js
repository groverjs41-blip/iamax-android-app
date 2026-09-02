// Universal Blob & Data URL downloader for Android WebView
(function() {
    if (window.__iamaxBlobDownloaderInstalled) return;
    window.__iamaxBlobDownloaderInstalled = true;

    function downloadBlob(blobUrl, filename) {
        fetch(blobUrl)
            .then(function(r) { return r.blob(); })
            .then(function(blob) {
                var reader = new FileReader();
                reader.onloadend = function() {
                    var base64data = reader.result;
                    if (window.AndroidBridge && typeof window.AndroidBridge.saveBase64File === 'function') {
                        window.AndroidBridge.saveBase64File(base64data, filename || 'descarga', blob.type || '');
                    }
                };
                reader.readAsDataURL(blob);
            })
            .catch(function(e) {
                console.error('[IAMAX] Blob download error:', e);
            });
    }

    document.addEventListener('click', function(e) {
        var el = e.target.closest('a[download], a[href^="blob:"], a[href^="data:"]');
        if (el && el.href) {
            var filename = el.getAttribute('download') || 'archivo';
            if (el.href.startsWith('blob:')) {
                e.preventDefault();
                e.stopPropagation();
                downloadBlob(el.href, filename);
            } else if (el.href.startsWith('data:')) {
                e.preventDefault();
                e.stopPropagation();
                if (window.AndroidBridge && typeof window.AndroidBridge.saveBase64File === 'function') {
                    window.AndroidBridge.saveBase64File(el.href, filename, '');
                }
            }
        }
    }, true);
})();
