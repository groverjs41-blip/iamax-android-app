package com.iamax.launcher.engine

import android.content.Context
import android.graphics.Bitmap
import android.net.http.SslError
import android.util.Log
import android.view.View
import android.webkit.SslErrorHandler
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.URLUtil
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ProgressBar
import androidx.webkit.WebViewAssetLoader
import com.iamax.launcher.MainActivity
import com.iamax.launcher.storage.SessionStorage

class IAmaxWebViewClient(
    private val context: Context,
    private val scriptInjector: ScriptInjector,
    private val sessionStorage: SessionStorage,
    private val credentialInjectorService: CredentialInjectorService,
    private val progressBar: ProgressBar,
    private val onNavigationStateChanged: (url: String, isDashboard: Boolean) -> Unit
) : WebViewClient() {

    private val assetLoader = WebViewAssetLoader.Builder()
        .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
        .build()

    private val turboCache = TurboCacheInterceptor(context)

    private val downloadableExtensions = setOf(
        "pdf", "zip", "rar", "7z", "tar", "gz", "csv", "xlsx", "xls",
        "docx", "doc", "pptx", "ppt", "mp3", "mp4", "wav", "m4a", "webm",
        "png", "jpg", "jpeg", "webp", "svg", "apk", "dmg", "exe", "json", "txt"
    )

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        // 1. Interceptar recursos locales del Dashboard
        val assetResponse = assetLoader.shouldInterceptRequest(request.url)
        if (assetResponse != null) {
            return assetResponse
        }

        // 2. Modo Turbo: Caché ultra-rápido de bundles pesados y bloqueo de rastreadores
        val turboResponse = turboCache.shouldIntercept(request)
        if (turboResponse != null) {
            return turboResponse
        }

        return super.shouldInterceptRequest(view, request)
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val url = request.url.toString()
        val lower = url.lowercase()
        Log.d("IAmaxWebViewClient", "Loading URL: $url")

        // Interceptar si es una descarga directa de archivo en Treblo, Nano Banana u otras herramientas
        val path = request.url.path ?: ""
        val lastDot = path.lastIndexOf('.')
        val ext = if (lastDot != -1) path.substring(lastDot + 1).lowercase() else ""
        val isDownloadExt = ext.isNotBlank() && downloadableExtensions.contains(ext)
        val hasDownloadParam = lower.contains("download=true") || lower.contains("download=1") ||
                               lower.contains("/download/") || lower.contains("/export/") ||
                               lower.contains("export=true")

        if (isDownloadExt || hasDownloadParam) {
            val fileName = URLUtil.guessFileName(url, null, null)
            (context as? MainActivity)?.let { mainAct ->
                mainAct.downloadDirect(url, fileName)
                return true
            }
        }

        if (lower.contains("accounts.google.") || lower.contains("google.com/signin") || lower.contains("google.com/servicelogin")) {
            val cleanUa = MainActivity.cleanMobileUserAgent
            if (cleanUa.isNotBlank() && view.settings.userAgentString != cleanUa) {
                view.settings.userAgentString = cleanUa
            }
        }
        return false
    }

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
        progressBar.visibility = View.VISIBLE
        val isDashboard = isDashboardUrl(url)
        val lower = url.lowercase()
        if (lower.contains("accounts.google.") || lower.contains("google.com/signin") || lower.contains("google.com/servicelogin")) {
            val cleanUa = MainActivity.cleanMobileUserAgent
            if (cleanUa.isNotBlank() && view.settings.userAgentString != cleanUa) {
                view.settings.userAgentString = cleanUa
            }
        }
        onNavigationStateChanged(url, isDashboard)
        scriptInjector.onPageStarted(view, url)

        if (!isDashboard) {
            val activeCardId = sessionStorage.getString("activeCardId", "")
            if (activeCardId.isNotBlank()) {
                val pendingLs = sessionStorage.getString("pending_ls_$activeCardId", "")
                val pendingSs = sessionStorage.getString("pending_ss_$activeCardId", "")
                scriptInjector.injectPendingStorage(view, pendingLs, pendingSs)
            }
        }
    }

    override fun onPageFinished(view: WebView, url: String) {
        super.onPageFinished(view, url)
        progressBar.visibility = View.GONE
        val isDashboard = isDashboardUrl(url)
        onNavigationStateChanged(url, isDashboard)
        scriptInjector.onPageFinished(view, url)

        if (!isDashboard) {
            (context as? MainActivity)?.hideToolLoader()
            val activeCardId = sessionStorage.getString("activeCardId", "")
            if (activeCardId.isNotBlank()) {
                val pendingLs = sessionStorage.getString("pending_ls_$activeCardId", "")
                val pendingSs = sessionStorage.getString("pending_ss_$activeCardId", "")
                scriptInjector.injectPendingStorage(view, pendingLs, pendingSs)

                val lower = url.lowercase()
                if (lower.contains("accounts.google.com/signin") || 
                    lower.contains("accounts.google.com/v3/signin") || 
                    lower.contains("accounts.google.com/servicelogin")) {
                    view.postDelayed({
                        credentialInjectorService.injectCredentials(view)
                    }, 500)
                }
            }
        }
    }

    override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
        handler?.proceed()
    }

    private fun isDashboardUrl(url: String): Boolean {
        return url.startsWith("https://appassets.androidplatform.net/assets/dashboard/") ||
               url.startsWith("file:///android_asset/dashboard/")
    }
}
