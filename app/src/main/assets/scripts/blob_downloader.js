// Universal Media & File Downloader for Android WebView
// Supports: Treblo AI Music, Gemini Imagen/Video, Blobs, Data URIs, FileSaver.js, and Audio/Video players
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

    // 1. Hook HTMLAnchorElement.prototype.click (Catches FileSaver.js, dynamic downloads, and scripts)
    var origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
        var href = this.href || '';
        var downloadAttr = this.getAttribute('download');
        var isDownload = downloadAttr !== null || href.startsWith('blob:') || href.startsWith('data:') ||
                         /\.(mp3|wav|m4a|aac|ogg|mp4|webm|pdf|zip|xlsx|csv|png|jpg|jpeg|webp)($|\?)/i.test(href);
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
                /\.(mp3|wav|m4a|aac|ogg|mp4|webm|pdf|zip|xlsx|csv|png|jpg|jpeg|webp)($|\?)/i.test(url)) {
                processDownload(url, '');
                return null;
            }
        }
        return origOpen.apply(this, arguments);
    };

    // 3. Intercept user clicks on links and download buttons (Treblo AI music, Gemini images/videos)
    document.addEventListener('click', function(e) {
        // A. Direct anchor links
        var a = e.target.closest('a');
        if (a && a.href) {
            var href = a.href;
            var isDownload = a.hasAttribute('download') || 
                             href.startsWith('blob:') || 
                             href.startsWith('data:') ||
                             /\.(mp3|wav|m4a|aac|ogg|mp4|webm|pdf|zip|xlsx|csv|png|jpg|jpeg|webp)($|\?)/i.test(href);
            if (isDownload) {
                var filename = a.getAttribute('download') || a.download || '';
                if (processDownload(href, filename)) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
            }
        }

        // B. Download buttons (Treblo music player, Gemini image download icon)
        var btn = e.target.closest('button, [role="button"], [role="menuitem"], .download-btn, [data-testid*="download"]');
        if (btn) {
            var aria = (btn.getAttribute('aria-label') || '').toLowerCase();
            var title = (btn.getAttribute('title') || '').toLowerCase();
            var text = (btn.textContent || '').trim().toLowerCase();
            var isDownloadAction = aria.includes('descargar') || aria.includes('download') ||
                                   title.includes('descargar') || title.includes('download') ||
                                   text === 'descargar' || text === 'download' ||
                                   text.includes('descargar audio') || text.includes('descargar mp3') ||
                                   text.includes('descargar video') || text.includes('descargar imagen') ||
                                   text.includes('download mp3') || text.includes('download audio');
            if (isDownloadAction) {
                var container = btn.closest('[data-testid*="audio"], [class*="audio"], [class*="track"], [class*="player"], [class*="music"], [class*="song"], [class*="card"], figure, .image-container, .video-container') || document;
                
                // Check for audio element
                var audio = container.querySelector('audio source, audio');
                if (audio && (audio.src || audio.currentSrc)) {
                    var src = audio.src || audio.currentSrc;
                    var titleEl = container.querySelector('h1, h2, h3, h4, [class*="title"], [class*="name"]');
                    var name = (titleEl ? titleEl.textContent : 'treblo_musica_' + Date.now()).trim().replace(/[^a-zA-Z0-9_-]/g, '_') + '.mp3';
                    if (processDownload(src, name)) {
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }
                }

                // Check for video element
                var video = container.querySelector('video source, video');
                if (video && (video.src || video.currentSrc)) {
                    var src = video.src || video.currentSrc;
                    var name = 'video_' + Date.now() + '.mp4';
                    if (processDownload(src, name)) {
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }
                }

                // Check for image element
                var img = container.querySelector('img');
                if (img && img.src && !img.src.includes('avatar') && !img.src.includes('icon')) {
                    var name = 'imagen_' + Date.now() + '.png';
                    if (processDownload(img.src, name)) {
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }
                }
            }
        }
    }, true);
})();
