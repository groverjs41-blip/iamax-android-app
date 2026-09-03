// Universal Media & File Downloader for Android WebView
// Supports: Treblo AI Music (OGG/MP3), Gemini Imagen/Video, Blobs, Data URIs, FileSaver.js, and dynamic anchors
(function() {
    if (window.__iamaxBlobDownloaderInstalled) return;
    window.__iamaxBlobDownloaderInstalled = true;

    function sendBase64(base64data, filename, mime) {
        if (!base64data || !window.AndroidBridge) return;
        var commaIdx = base64data.indexOf(',');
        var cleanData = commaIdx !== -1 ? base64data.substring(commaIdx + 1) : base64data;

        if (cleanData.length > 250000 && typeof window.AndroidBridge.saveBase64Chunk === 'function') {
            var chunkSize = 150000;
            var total = Math.ceil(cleanData.length / chunkSize);
            var tx = 'tx_' + Date.now();
            for (var i = 0; i < total; i++) {
                var chunk = cleanData.substring(i * chunkSize, (i + 1) * chunkSize);
                window.AndroidBridge.saveBase64Chunk(tx, i, total, chunk, filename || 'descarga', mime || '');
            }
        } else if (typeof window.AndroidBridge.saveBase64File === 'function') {
            window.AndroidBridge.saveBase64File(cleanData, filename || 'descarga', mime || '');
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

    // 3. Intercept clicks on explicit download links and media buttons
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

    // 4. Long press on Video or Audio (allows downloading Gemini videos and Treblo audio by holding down)
    var touchTimer = null;
    document.addEventListener('touchstart', function(e) {
        var video = e.target.closest('video');
        var audio = e.target.closest('audio');
        var media = video || audio;
        if (media) {
            touchTimer = setTimeout(function() {
                var src = media.currentSrc || media.src;
                if (!src) {
                    var source = media.querySelector('source');
                    if (source) src = source.src;
                }
                if (src) {
                    var ext = video ? '.mp4' : '.ogg';
                    var name = (video ? 'gemini_video_' : 'treblo_audio_') + Date.now() + ext;
                    processDownload(src, name);
                }
            }, 600);
        }
    }, { passive: true });

    document.addEventListener('touchend', function() {
        if (touchTimer) clearTimeout(touchTimer);
    }, { passive: true });
    document.addEventListener('touchmove', function() {
        if (touchTimer) clearTimeout(touchTimer);
    }, { passive: true });

    // 5. Context menu on Video
    document.addEventListener('contextmenu', function(e) {
        var video = e.target.closest('video');
        if (video) {
            var src = video.currentSrc || video.src;
            if (!src) {
                var source = video.querySelector('source');
                if (source) src = source.src;
            }
            if (src) {
                e.preventDefault();
                processDownload(src, 'gemini_video_' + Date.now() + '.mp4');
            }
        }
    }, true);
})();
