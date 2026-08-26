package com.iamax.launcher

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.ValueCallback
import android.webkit.WebSettings
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

    private val dashboardUrl = "file:///android_asset/dashboard/index.html"

    @SuppressLint("SetJavaScriptEnabled")
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
            onNavigateToUrl = { url -> binding.webView.loadUrl(url) },
            onReturnToDashboard = { loadDashboard() }
        )

        setupWebView()
        setupFloatingBar()
        setupBackNavigation()

        loadDashboard()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val webView = binding.webView
        val settings = webView.settings

        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.loadWithOverviewMode = true
        settings.useWideViewPort = true
        settings.setSupportMultipleWindows(false)
        settings.javaScriptCanOpenWindowsAutomatically = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW

        // User-Agent estándar para compatibilidad con Google, ChatGPT, Grok
        val defaultUa = settings.userAgentString
        settings.userAgentString = defaultUa.replace("; wv", "")

        webView.addJavascriptInterface(bridge, "AndroidBridge")

        webView.webViewClient = IAmaxWebViewClient(
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

    private fun setupFloatingBar() {
        binding.btnNavBack.setOnClickListener {
            if (binding.webView.canGoBack()) {
                binding.webView.goBack()
            } else {
                loadDashboard()
            }
        }

        binding.btnNavRefresh.setOnClickListener {
            binding.webView.reload()
        }

        binding.btnNavHome.setOnClickListener {
            loadDashboard()
        }
    }

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val currentUrl = binding.webView.url ?: ""
                val isDashboard = currentUrl.startsWith("file:///android_asset/")

                if (isDashboard) {
                    finish()
                } else if (binding.webView.canGoBack()) {
                    binding.webView.goBack()
                } else {
                    loadDashboard()
                }
            }
        })
    }

    private fun loadDashboard() {
        binding.webView.loadUrl(dashboardUrl)
    }

    override fun onDestroy() {
        binding.webView.destroy()
        super.onDestroy()
    }
}
