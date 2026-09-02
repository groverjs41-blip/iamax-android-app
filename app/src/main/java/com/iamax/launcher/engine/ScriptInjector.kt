package com.iamax.launcher.engine

import android.content.Context
import android.util.Base64
import android.util.Log
import android.webkit.WebView
import java.io.InputStream

class ScriptInjector(private val context: Context) {

    private val preloadedScripts = mutableMapOf<String, String>()

    init {
        // Pre-carga en memoria todos los scripts para que la inyección sea instantánea (0ms de lectura en disco)
        val scriptPaths = listOf(
            "scripts/modules/content-client.js",
            "scripts/shield.css",
            "scripts/universal_shield.js",
            "scripts/clear_cache_btn.js",
            "scripts/spoof.js",
            "scripts/grok_download.js",
            "scripts/blocker.js",
            "scripts/google_shield.js",
            "scripts/iamax_inject_btn.js",
            "scripts/gemini_shield.js",
            "scripts/chatgpt_ip_check.js",
            "scripts/bot_autologin.js",
            "scripts/streaming_adblock.js",
            "scripts/auto_injector.js",
            "scripts/credential_mask.js"
        )

        for (path in scriptPaths) {
            try {
                context.assets.open(path).use { inputStream: InputStream ->
                    val content = inputStream.bufferedReader().use { it.readText() }
                    if (content.isNotBlank()) {
                        preloadedScripts[path] = Base64.encodeToString(content.toByteArray(), Base64.NO_WRAP)
                    }
                }
            } catch (e: Exception) {
                Log.w("ScriptInjector", "Error preloading script: $path -> ${e.message}")
            }
        }
    }

    /**
     * Injects CSS stylesheet into the current page instantly using pre-cached base64.
     */
    fun injectCss(webView: WebView, assetPath: String) {
        val encoded = preloadedScripts[assetPath] ?: return

        val js = """
            (function() {
                var parent = document.head || document.documentElement;
                var style = document.getElementById('iamax-injected-style');
                if (!style) {
                    style = document.createElement('style');
                    style.id = 'iamax-injected-style';
                    style.type = 'text/css';
                    parent.appendChild(style);
                }
                style.textContent += atob('$encoded');
            })();
        """.trimIndent()

        webView.evaluateJavascript(js, null)
    }

    /**
     * Injects JS file into the WebView instantly.
     */
    fun injectJs(webView: WebView, assetPath: String) {
        val encoded = preloadedScripts[assetPath] ?: return

        val js = """
            (function() {
                try {
                    var script = document.createElement('script');
                    script.type = 'text/javascript';
                    script.text = decodeURIComponent(escape(atob('$encoded')));
                    (document.head || document.documentElement).appendChild(script);
                } catch(e) {
                    console.error('IAmax script injection error ($assetPath):', e);
                }
            })();
        """.trimIndent()

        webView.evaluateJavascript(js, null)
    }

    /**
     * Injects scripts configured for document_start.
     */
    fun onPageStarted(webView: WebView, url: String) {
        if (url.startsWith("https://appassets.androidplatform.net/") ||
            url.startsWith("file:///android_asset/")) return

        val lowerUrl = url.lowercase()

        // Universal content client & shield CSS
        injectJs(webView, "scripts/modules/content-client.js")
        injectCss(webView, "scripts/shield.css")
        injectJs(webView, "scripts/universal_shield.js")
        injectJs(webView, "scripts/clear_cache_btn.js")
        injectJs(webView, "scripts/auto_injector.js")

        // Spoof check exclusions
        val isExcludedSpoof = lowerUrl.contains("scribd.com") ||
                lowerUrl.contains("challenges.cloudflare.com") ||
                lowerUrl.contains("arkoselabs.com") ||
                lowerUrl.contains("hcaptcha.com") ||
                lowerUrl.contains("recaptcha.net")

        if (!isExcludedSpoof) {
            injectJs(webView, "scripts/spoof.js")
        }

        // Domain specific scripts at start
        if (lowerUrl.contains("grok.com")) {
            injectJs(webView, "scripts/grok_download.js")
        }

        if (lowerUrl.contains("accounts.google.com") || lowerUrl.contains("notebooklm.google.com")) {
            injectJs(webView, "scripts/blocker.js")
            injectJs(webView, "scripts/google_shield.js")
            injectJs(webView, "scripts/iamax_inject_btn.js")
        }

        if (lowerUrl.contains("pelotaalibre.su") || lowerUrl.contains("pelota-libre.com.co") ||
            lowerUrl.contains("crunchyroll.com") || lowerUrl.contains("primevideo.com") ||
            lowerUrl.contains("magistv.video") || lowerUrl.contains("magis.tv")) {
            injectJs(webView, "scripts/streaming_adblock.js")
        }
    }

    /**
     * Injects scripts configured for document_end / idle.
     */
    fun onPageFinished(webView: WebView, url: String) {
        if (url.startsWith("https://appassets.androidplatform.net/") ||
            url.startsWith("file:///android_asset/")) return

        val lowerUrl = url.lowercase()

        if (lowerUrl.contains("gemini.google.com")) {
            injectJs(webView, "scripts/gemini_shield.js")
        }

        if (lowerUrl.contains("chatgpt.com")) {
            injectJs(webView, "scripts/chatgpt_ip_check.js")
        }

        if (lowerUrl.contains("botiamax-production.up.railway.app") ||
            lowerUrl.contains("iamaxbotcrm.online") ||
            lowerUrl.contains("2.24.116.152")) {
            injectJs(webView, "scripts/bot_autologin.js")
        }
    }
}
