// Universal Downloader for Android WebView (Handles Blob, Data URI, FileSaver.js, and HTTP download anchors)
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

    function processDownload(href, filename) {
        if (!href) return false;
        if (href.startsWith('blob:')) {
            downloadBlob(href, filename);
            return true;
        } else if (href.startsWith('data:')) {
            if (window.AndroidBridge && typeof window.AndroidBridge.saveBase64File === 'function') {
                window.AndroidBridge.saveBase64File(href, filename || 'descarga', '');
                return true;
            }
        } else if (href.startsWith('http://') || href.startsWith('https://')) {
            if (window.AndroidBridge && typeof window.AndroidBridge.downloadHttpFile === 'function') {
                window.AndroidBridge.downloadHttpFile(href, filename || '', '');
                return true;
            }
        }
        return false;
    }

    // 1. Hook HTMLAnchorElement.prototype.click (Catches FileSaver.js, dynamic downloads, and libraries)
    var origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
        var href = this.href || '';
        var downloadAttr = this.getAttribute('download');
        var isDownload = downloadAttr !== null || href.startsWith('blob:') || href.startsWith('data:');
        if (isDownload) {
            var handled = processDownload(href, downloadAttr || '');
            if (handled) return;
        }
        return origClick.apply(this, arguments);
    };

    // 2. Intercept document-level click on any link or download button
    document.addEventListener('click', function(e) {
        var el = e.target.closest('a[download], a[href^="blob:"], a[href^="data:"]');
        if (el && el.href) {
            var filename = el.getAttribute('download') || '';
            var handled = processDownload(el.href, filename);
            if (handled) {
                e.preventDefault();
                e.stopPropagation();
            }
        }
    }, true);
})();
