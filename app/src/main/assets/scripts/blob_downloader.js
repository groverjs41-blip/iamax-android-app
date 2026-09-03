// Universal Media & File Downloader for Android WebView
// Supports: Treblo AI Music (OGG/MP3), Gemini Imagen/Video, Blobs, Data URIs, FileSaver.js, and dynamic anchors
(function() {
    if (window.__iamaxBlobDownloaderInstalled) return;
    window.__iamaxBlobDownloaderInstalled = true;

    function sendBase64(base64data, filename, mime) {
        if (!base64data || !window.AndroidBridge) return;
        var commaIdx = base64data.indexOf(',');
        var cleanData = commaIdx !== -1 ? base64data.substring(commaIdx + 1) : base64data;

        if (cleanData.length > 200000 && typeof window.AndroidBridge.saveBase64Chunk === 'function') {
            var chunkSize = 100000;
            var total = Math.ceil(cleanData.length / chunkSize);
            var tx = 'tx_' + Date.now();
            var i = 0;
            function sendNext() {
                if (i < total) {
                    var chunk = cleanData.substring(i * chunkSize, (i + 1) * chunkSize);
                    window.AndroidBridge.saveBase64Chunk(tx, i, total, chunk, filename || 'descarga', mime || '');
                    i++;
                    if (i % 3 === 0) {
                        setTimeout(sendNext, 12);
                    } else {
                        sendNext();
                    }
                }
            }
            sendNext();
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

    function findActiveAudio(target) {
        if (!target) return null;
        // 1. In target's closest container
        var container = target.closest('[class*="track"], [class*="song"], [class*="card"], [class*="player"], [class*="item"], [class*="row"]') || target.parentElement;
        if (container) {
            var a = container.querySelector('audio');
            if (a && (a.currentSrc || a.src)) return a;
        }
        // 2. Any playing audio in document
        var allAudios = document.querySelectorAll('audio');
        for (var i = 0; i < allAudios.length; i++) {
            var aud = allAudios[i];
            if (!aud.paused || aud.currentTime > 0) {
                return aud;
            }
        }
        // 3. Fallback to any audio with a src
        for (var j = 0; j < allAudios.length; j++) {
            if (allAudios[j].currentSrc || allAudios[j].src) {
                return allAudios[j];
            }
        }
        return null;
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

    // 3. Intercept user clicks on explicit download links or buttons
    document.addEventListener('click', function(e) {
        // A) Anchor with download
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
                    return;
                }
            }
        }

        // B) Buttons for download (Gemini video icon, Treblo audio card download button)
        var btn = e.target.closest('button, [role="button"], a, [class*="download"], [class*="descargar"], [aria-label*="download" i], [aria-label*="descargar" i], [title*="download" i], [title*="descargar" i]');
        if (btn) {
            var text = (btn.textContent || '').toLowerCase();
            var aria = (btn.getAttribute('aria-label') || '').toLowerCase();
            var titleAttr = (btn.getAttribute('title') || '').toLowerCase();
            var isDownloadBtn = text.includes('download') || text.includes('descargar') || text.includes('bajar') ||
                                text.includes('ogg') || text.includes('mp3') || text.includes('wav') ||
                                aria.includes('download') || aria.includes('descargar') ||
                                titleAttr.includes('download') || titleAttr.includes('descargar');
            if (isDownloadBtn) {
                var container = btn.closest('figure, [class*="video"], [class*="audio"], [class*="track"], [class*="song"], [class*="player"], [class*="card"], [class*="item"]') || btn.parentElement;
                var vid = container ? container.querySelector('video') : document.querySelector('video');
                if (vid && (vid.currentSrc || vid.src)) {
                    processDownload(vid.currentSrc || vid.src, 'gemini_video_' + Date.now() + '.mp4');
                    return;
                }
                var aud = findActiveAudio(btn);
                if (aud && (aud.currentSrc || aud.src)) {
                    var titleEl = container ? container.querySelector('h1, h2, h3, h4, [class*="title"], [class*="name"]') : null;
                    var aname = (titleEl ? titleEl.textContent : 'treblo_musica_' + Date.now()).trim().replace(/[^a-zA-Z0-9_-]/g, '_') + '.ogg';
                    processDownload(aud.currentSrc || aud.src, aname);
                    return;
                }
            }
        }
    }, true);

    // 4. Long press on Video, Image or Audio (allows holding down on Gemini videos and Treblo audio cards)
    var touchTimer = null;
    document.addEventListener('touchstart', function(e) {
        var el = e.target;
        touchTimer = setTimeout(function() {
            // Check video
            var vid = el.closest('video') || (el.closest('figure, [class*="video"]') ? el.closest('figure, [class*="video"]').querySelector('video') : null);
            if (vid && (vid.currentSrc || vid.src)) {
                processDownload(vid.currentSrc || vid.src, 'gemini_video_' + Date.now() + '.mp4');
                return;
            }
            // Check image
            var img = el.closest('img');
            if (img && img.src && !img.src.startsWith('data:image/svg')) {
                processDownload(img.src, 'imagen_' + Date.now() + '.png');
                return;
            }
            // Check audio / music card
            var aud = findActiveAudio(el);
            if (aud && (aud.currentSrc || aud.src)) {
                var container = el.closest('[class*="track"], [class*="song"], [class*="card"], [class*="player"], [class*="item"]');
                var titleEl = container ? container.querySelector('h1, h2, h3, h4, [class*="title"], [class*="name"]') : null;
                var aname = (titleEl ? titleEl.textContent : 'treblo_musica_' + Date.now()).trim().replace(/[^a-zA-Z0-9_-]/g, '_') + '.ogg';
                processDownload(aud.currentSrc || aud.src, aname);
                return;
            }
        }, 550);
    }, { passive: true });

    document.addEventListener('touchend', function() {
        if (touchTimer) clearTimeout(touchTimer);
    }, { passive: true });
    document.addEventListener('touchmove', function() {
        if (touchTimer) clearTimeout(touchTimer);
    }, { passive: true });

    // 5. Context menu on Video & Audio
    document.addEventListener('contextmenu', function(e) {
        var video = e.target.closest('video');
        if (video) {
            var src = video.currentSrc || video.src;
            if (src) {
                e.preventDefault();
                processDownload(src, 'gemini_video_' + Date.now() + '.mp4');
                return;
            }
        }
        var aud = findActiveAudio(e.target);
        if (aud && (aud.currentSrc || aud.src)) {
            e.preventDefault();
            processDownload(aud.currentSrc || aud.src, 'treblo_musica_' + Date.now() + '.ogg');
        }
    }, true);
})();
