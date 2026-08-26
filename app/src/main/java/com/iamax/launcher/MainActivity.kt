package com.iamax.launcher

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.iamax.launcher.bridge.IAmaxBridge
import com.iamax.launcher.databinding.ActivityMainBinding
import com.iamax.launcher.engine.CookieInjector
import com.iamax.launcher.engine.IAmaxWebChromeClient
import com.iamax.launcher.engine.IAmaxWebViewClient
import com.iamax.launcher.engine.ScriptInjector
import com.iamax.launcher.storage.SessionStorage

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var sessionStorage: SessionStorage
    private lateinit var cookieInjector: CookieInjector
    private lateinit var scriptInjector: ScriptInjector
    private lateinit var bridge: IAmaxBridge

    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK && result.data != null) {
            val data = result.data
            val clipData = data?.clipData
            val uri = data?.data

            if (clipData != null) {
                val uris = Array(clipData.itemCount) { i -> clipData.getItemAt(i).uri }
                fileUploadCallback?.onReceiveValue(uris)
            } else if (uri != null) {
                fileUploadCallback?.onReceiveValue(arrayOf(uri))
            } else {
                fileUploadCallback?.onReceiveValue(null)
            }
        } else {
            fileUploadCallback?.onReceiveValue(null)
        }
        fileUploadCallback = null
    }

    private val dashboardUrl = "https://appassets.androidplatform.net/assets/dashboard/index.html"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        sessionStorage = SessionStorage(this)
        cookieInjector = CookieInjector()
        scriptInjector = ScriptInjector(this)

        bridge = IAmaxBridge(
            activity = this,
            sessionStorage = sessionStorage,
            cookieInjector = cookieInjector,
            onNavigateToUrl = { url -> openToolUrl(url) },
            onReturnToDashboard = { showDashboard() }
        )

        setupDashboardWebView()
        setupToolWebView()
        setupFloatingBar()
        setupBackNavigation()

        showDashboard()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun applyHighSpeedSettings(webView: WebView) {
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.allowFileAccessFromFileURLs = true
        settings.allowUniversalAccessFromFileURLs = true
        settings.loadWithOverviewMode = true
        settings.useWideViewPort = true
        settings.setSupportMultipleWindows(false)
        settings.javaScriptCanOpenWindowsAutomatically = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        settings.offscreenPreRaster = true
        settings.safeBrowsingEnabled = false

        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)

        val defaultUa = settings.userAgentString
        settings.userAgentString = defaultUa.replace("; wv", "")

        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)
    }

    private fun setupDashboardWebView() {
        val webView = binding.dashboardWebView
        applyHighSpeedSettings(webView)

        webView.addJavascriptInterface(bridge, "AndroidBridge")

        webView.webViewClient = IAmaxWebViewClient(
            context = this,
            scriptInjector = scriptInjector,
            progressBar = binding.progressBar,
            onNavigationStateChanged = { _, _ -> }
        )

        webView.loadUrl(dashboardUrl)
    }

    private fun setupToolWebView() {
        val webView = binding.toolWebView
        applyHighSpeedSettings(webView)

        webView.webViewClient = IAmaxWebViewClient(
            context = this,
            scriptInjector = scriptInjector,
            progressBar = binding.progressBar,
            onNavigationStateChanged = { _, isDashboard ->
                binding.floatingNavBar.visibility = if (isDashboard) View.GONE else View.VISIBLE
            }
        )

        webView.webChromeClient = IAmaxWebChromeClient(
            progressBar = binding.progressBar,
            onFileChooser = { filePathCallback, fileChooserParams ->
                fileUploadCallback?.onReceiveValue(null)
                fileUploadCallback = filePathCallback

                val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                    type = "*/*"
                    addCategory(Intent.CATEGORY_OPENABLE)
                }

                try {
                    fileChooserLauncher.launch(intent)
                    true
                } catch (e: Exception) {
                    fileUploadCallback = null
                    false
                }
            }
        )
    }

    private fun openToolUrl(url: String) {
        binding.dashboardWebView.visibility = View.GONE
        binding.toolWebView.visibility = View.VISIBLE
        binding.floatingNavBar.visibility = View.VISIBLE
        binding.toolWebView.loadUrl(url)
    }

    private fun showDashboard() {
        binding.toolWebView.visibility = View.GONE
        binding.dashboardWebView.visibility = View.VISIBLE
        binding.floatingNavBar.visibility = View.GONE
        binding.progressBar.visibility = View.GONE
    }

    private fun setupFloatingBar() {
        binding.btnNavBack.setOnClickListener {
            if (binding.toolWebView.canGoBack()) {
                binding.toolWebView.goBack()
            } else {
                showDashboard()
            }
        }

        binding.btnNavRefresh.setOnClickListener {
            binding.toolWebView.reload()
        }

        binding.btnNavHome.setOnClickListener {
            showDashboard()
        }
    }

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (binding.toolWebView.visibility == View.VISIBLE) {
                    if (binding.toolWebView.canGoBack()) {
                        binding.toolWebView.goBack()
                    } else {
                        showDashboard()
                    }
                } else {
                    finish()
                }
            }
        })
    }

    override fun onDestroy() {
        binding.dashboardWebView.destroy()
        binding.toolWebView.destroy()
        super.onDestroy()
    }
}
