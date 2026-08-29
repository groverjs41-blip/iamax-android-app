package com.iamax.launcher.engine

import android.content.Context
import android.graphics.Bitmap
import android.net.http.SslError
import android.util.Log
import android.view.View
import android.webkit.SslErrorHandler
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ProgressBar
import androidx.webkit.WebViewAssetLoader

class IAmaxWebViewClient(
    context: Context,
    private val scriptInjector: ScriptInjector,
    private val progressBar: ProgressBar,
    private val onNavigationStateChanged: (url: String, isDashboard: Boolean) -> Unit
) : WebViewClient() {

    private val assetLoader = WebViewAssetLoader.Builder()
        .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
        .build()

    private val turboCache = TurboCacheInterceptor(context)

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
        Log.d("IAmaxWebViewClient", "Loading URL: $url")
        return false
    }

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
        progressBar.visibility = View.VISIBLE
        val isDashboard = isDashboardUrl(url)
        onNavigationStateChanged(url, isDashboard)
        scriptInjector.onPageStarted(view, url)
    }

    override fun onPageFinished(view: WebView, url: String) {
        super.onPageFinished(view, url)
        progressBar.visibility = View.GONE
        val isDashboard = isDashboardUrl(url)
        onNavigationStateChanged(url, isDashboard)
        scriptInjector.onPageFinished(view, url)
    }

    override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
        handler?.proceed()
    }

    private fun isDashboardUrl(url: String): Boolean {
        return url.startsWith("https://appassets.androidplatform.net/assets/dashboard/") ||
               url.startsWith("file:///android_asset/dashboard/")
    }
}
