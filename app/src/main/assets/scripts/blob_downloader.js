// Universal Media & File Downloader for Android WebView
// Supports: Treblo AI Music (OGG/MP3), Gemini Imagen/Video, Blobs, Data URIs, FileSaver.js, and dynamic anchors
(function() {
    if (window.__iamaxBlobDownloaderInstalled) return;
    window.__iamaxBlobDownloaderInstalled = true;

    function sendBase64(base64data, filename, mime) {
        if (!base64data || !window.AndroidBridge) return;
        if (base64data.length > 400000 && typeof window.AndroidBridge.saveBase64Chunk === 'function') {
            var chunkSize = 200000;
            var total = Math.ceil(base64data.length / chunkSize);
            var tx = 'tx_' + Date.now();
            for (var i = 0; i < total; i++) {
                var chunk = base64data.substring(i * chunkSize, (i + 1) * chunkSize);
                window.AndroidBridge.saveBase64Chunk(tx, i, total, chunk, filename || 'descarga', mime || '');
            }
        } else if (typeof window.AndroidBridge.saveBase64File === 'function') {
            window.AndroidBridge.saveBase64File(base64data, filename || 'descarga', mime || '');
        }
    }

    function downloadBlob(blobUrl, filename) {
        fetch(blobUrl)
            .then(function(r) { return r.blob(); })
            .then(function(blob) {
                var reader = new FileReader();
                reader.onloadend = function() {
                    sendBase64(reader.result, filename, blob.type || '');
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
            sendBase64(href, filename, '');
            return true;
        } else if (href.startsWith('http://') || href.startsWith('https://')) {
            if (window.AndroidBridge && typeof window.AndroidBridge.downloadHttpFile === 'function') {
                window.AndroidBridge.downloadHttpFile(href, filename || '', '');
                return true;
            }
        }
        return false;
    }

    // 1. Hook HTMLAnchorElement.prototype.click (Catches FileSaver.js, Treblo OGG/MP3 dynamic downloads, and libraries)
    var origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
        var href = this.href || '';
        var downloadAttr = this.getAttribute('download');
        var isDownload = downloadAttr !== null || href.startsWith('blob:') || href.startsWith('data:') ||
                         /\.(mp3|ogg|wav|m4a|aac|mp4|webm|pdf|zip|xlsx|csv|png|jpg|jpeg|webp)($|\?)/i.test(href);
        if (isDownload) {
            var handled = processDownload(href, downloadAttr || this.download || '');
            if (handled) return;
        }
        return origClick.apply(this, arguments);
    };

    // 2. Hook window.open to intercept direct media downloads
    var origOpen = window.open;
    window.open = function(url) {
        if (url && typeof url === 'string') {
            if (url.startsWith('blob:') || url.startsWith('data:') ||
                /\.(mp3|ogg|wav|m4a|aac|mp4|webm|pdf|zip|xlsx|csv|png|jpg|jpeg|webp)($|\?)/i.test(url)) {
                processDownload(url, '');
                return null;
            }
        }
        return origOpen.apply(this, arguments);
    };

    // 3. Intercept user clicks on explicit download links
    document.addEventListener('click', function(e) {
        var a = e.target.closest('a');
        if (a && a.href) {
            var href = a.href;
            var isDownload = a.hasAttribute('download') || 
                             href.startsWith('blob:') || 
                             href.startsWith('data:') ||
                             /\.(mp3|ogg|wav|m4a|aac|mp4|webm|pdf|zip|xlsx|csv|png|jpg|jpeg|webp)($|\?)/i.test(href);
            if (isDownload) {
                var filename = a.getAttribute('download') || a.download || '';
                if (processDownload(href, filename)) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            }
        }
    }, true);
})();
