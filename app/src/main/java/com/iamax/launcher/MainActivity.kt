package com.iamax.launcher

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.view.View
import android.webkit.CookieManager
import android.webkit.MimeTypeMap
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.iamax.launcher.bridge.IAmaxBridge
import com.iamax.launcher.databinding.ActivityMainBinding
import com.iamax.launcher.engine.CookieInjector
import com.iamax.launcher.engine.CredentialInjectorService
import com.iamax.launcher.engine.IAmaxWebChromeClient
import com.iamax.launcher.engine.IAmaxWebViewClient
import com.iamax.launcher.engine.NetworkPrewarmer
import com.iamax.launcher.engine.ScriptInjector
import com.iamax.launcher.storage.SessionStorage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

class MainActivity : AppCompatActivity() {

    companion object {
        var cleanMobileUserAgent: String = ""
    }

    private lateinit var binding: ActivityMainBinding
    private lateinit var sessionStorage: SessionStorage
    private lateinit var cookieInjector: CookieInjector
    private lateinit var scriptInjector: ScriptInjector
    private lateinit var credentialInjectorService: CredentialInjectorService
    private lateinit var bridge: IAmaxBridge

    private val httpClient = OkHttpClient()
    private val gson = Gson()
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
        credentialInjectorService = CredentialInjectorService(this, sessionStorage)

        bridge = IAmaxBridge(
            activity = this,
            sessionStorage = sessionStorage,
            cookieInjector = cookieInjector,
            credentialInjectorService = credentialInjectorService,
            webViewProvider = { binding.dashboardWebView },
            toolWebViewProvider = { binding.toolWebView },
            onApplyUserAgent = { ua ->
                binding.toolWebView.settings.userAgentString = ua
            },
            onNavigateToUrl = { url -> openToolUrl(url) },
            onReturnToDashboard = { showDashboard() }
        )

        setupDashboardWebView()
        setupToolWebView()
        setupFloatingBar()
        setupBackNavigation()

        showDashboard()
        NetworkPrewarmer.prewarmAll()
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
        val cleanUa = defaultUa
            .replace("; wv", "")
            .replace("(?i)version/[0-9.]+\\s*".toRegex(), "")
        cleanMobileUserAgent = cleanUa
        settings.userAgentString = cleanUa

        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        // Native Download Manager (Handles HTTP, HTTPS, blob:, and data: URIs)
        webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            try {
                if (url.startsWith("blob:") || url.startsWith("data:")) {
                    val guessName = URLUtil.guessFileName(url, contentDisposition, mimeType)
                    webView.evaluateJavascript(
                        """
                        (function() {
                            var blobUrl = '$url';
                            fetch(blobUrl)
                                .then(function(r) { return r.blob(); })
                                .then(function(blob) {
                                    var reader = new FileReader();
                                    reader.onloadend = function() {
                                        var base64data = reader.result;
                                        if (window.AndroidBridge && typeof window.AndroidBridge.saveBase64File === 'function') {
                                            window.AndroidBridge.saveBase64File(base64data, '$guessName', blob.type || '$mimeType');
                                        }
                                    };
                                    reader.readAsDataURL(blob);
                                })
                                .catch(function(err) {
                                    console.error('Blob fetch error:', err);
                                });
                        })();
                        """.trimIndent(), null
                    )
                    return@setDownloadListener
                }

                val request = DownloadManager.Request(Uri.parse(url)).apply {
                    setMimeType(mimeType)
                    addRequestHeader("User-Agent", userAgent)
                    addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url))
                    setDescription("Descargando archivo...")
                    val fileName = URLUtil.guessFileName(url, contentDisposition, mimeType)
                    setTitle(fileName)
                    setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
                }
                val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                dm.enqueue(request)
                Toast.makeText(this, "Descargando archivo...", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(this, "Error al descargar: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun setupDashboardWebView() {
        val webView = binding.dashboardWebView
        applyHighSpeedSettings(webView)

        webView.addJavascriptInterface(bridge, "AndroidBridge")

        webView.webViewClient = IAmaxWebViewClient(
            context = this,
            scriptInjector = scriptInjector,
            sessionStorage = sessionStorage,
            credentialInjectorService = credentialInjectorService,
            progressBar = binding.progressBar,
            onNavigationStateChanged = { _, _ -> }
        )

        webView.loadUrl(dashboardUrl)
    }

    private fun setupToolWebView() {
        val webView = binding.toolWebView
        applyHighSpeedSettings(webView)

        webView.addJavascriptInterface(bridge, "AndroidBridge")

        webView.webViewClient = IAmaxWebViewClient(
            context = this,
            scriptInjector = scriptInjector,
            sessionStorage = sessionStorage,
            credentialInjectorService = credentialInjectorService,
            progressBar = binding.progressBar,
            onNavigationStateChanged = { _, isDashboard ->
                binding.floatingNavBarScroll.visibility = if (isDashboard) View.GONE else View.VISIBLE
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

    fun showToolLoader(title: String = "Iniciando perfil seguro...", subtitle: String = "Aislando sesión y cargando recursos...") {
        runOnUiThread {
            binding.tvLoadingTitle.text = title
            binding.tvLoadingSubtitle.text = subtitle
            binding.toolLoadingOverlay.alpha = 1f
            binding.toolLoadingOverlay.visibility = View.VISIBLE
            binding.progressBar.visibility = View.VISIBLE
        }
    }

    fun hideToolLoader() {
        runOnUiThread {
            if (binding.toolLoadingOverlay.visibility == View.VISIBLE) {
                binding.toolLoadingOverlay.animate()
                    .alpha(0f)
                    .setDuration(250)
                    .withEndAction {
                        binding.toolLoadingOverlay.visibility = View.GONE
                        binding.toolLoadingOverlay.alpha = 1f
                    }
                    .start()
            }
            binding.progressBar.visibility = View.GONE
        }
    }

    private fun openToolUrl(url: String) {
        binding.dashboardWebView.visibility = View.GONE
        binding.toolWebView.visibility = View.VISIBLE
        binding.floatingNavBarScroll.visibility = View.VISIBLE
        binding.btnRestoreFloatingBar.visibility = View.GONE
        showToolLoader()
        binding.toolWebView.loadUrl(url)
    }

    private fun showDashboard() {
        binding.toolWebView.visibility = View.GONE
        binding.dashboardWebView.visibility = View.VISIBLE
        binding.floatingNavBarScroll.visibility = View.GONE
        binding.btnRestoreFloatingBar.visibility = View.GONE
        binding.progressBar.visibility = View.GONE
        binding.toolLoadingOverlay.visibility = View.GONE
        // Descargar toolWebView a about:blank para liberar memoria y evitar que la sesión anterior persista
        binding.toolWebView.loadUrl("about:blank")
    }

    fun downloadDirect(url: String, suggestedFileName: String) {
        runOnUiThread {
            try {
                val uri = Uri.parse(url)
                val fileName = if (suggestedFileName.isNotBlank()) suggestedFileName else URLUtil.guessFileName(url, null, null)
                val ext = MimeTypeMap.getFileExtensionFromUrl(url)
                val mimeType = if (ext.isNotBlank()) MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.lowercase()) else null
                val cookies = CookieManager.getInstance().getCookie(url) ?: ""
                val ua = cleanMobileUserAgent

                val request = DownloadManager.Request(uri).apply {
                    if (mimeType != null) setMimeType(mimeType)
                    if (ua.isNotBlank()) addRequestHeader("User-Agent", ua)
                    if (cookies.isNotBlank()) addRequestHeader("Cookie", cookies)
                    setDescription("Descargando archivo...")
                    setTitle(fileName)
                    setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
                }
                val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                dm.enqueue(request)
                Toast.makeText(this, "Descargando en Descargas: $fileName", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(this, "Error al descargar: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
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

        // Minimizar/Ocultar barra flotante para dejar pantalla completa
        binding.btnNavMinimize.setOnClickListener {
            binding.floatingNavBarScroll.visibility = View.GONE
            binding.btnRestoreFloatingBar.visibility = View.VISIBLE
        }

        // Restaurar barra flotante al tocar el icono discreto
        binding.btnRestoreFloatingBar.setOnClickListener {
            binding.btnRestoreFloatingBar.visibility = View.GONE
            binding.floatingNavBarScroll.visibility = View.VISIBLE
        }

        // 1. Inyectar Credenciales del Perfil (login_email, login_password, totpCode del perfil activo)
        binding.btnNavInject.setOnClickListener {
            credentialInjectorService.injectCredentials(binding.toolWebView)
        }

        // 2. Limpiar Caché y Cookies
        binding.btnNavClearCache.setOnClickListener {
            val currentUrl = binding.toolWebView.url ?: ""
            if (currentUrl.isNotBlank()) {
                try {
                    val domain = Uri.parse(currentUrl).host
                    cookieInjector.clearCookies(domain)
                    WebStorage.getInstance().deleteAllData()
                    binding.toolWebView.clearCache(true)
                    binding.toolWebView.reload()
                    Toast.makeText(this, "🧹 Caché y cookies limpiadas para $domain", Toast.LENGTH_SHORT).show()
                } catch (e: Exception) {
                    Toast.makeText(this, "Error al limpiar: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }

        // 3. Verificar IP / Proxy
        binding.btnNavCheckIp.setOnClickListener {
            Toast.makeText(this, "🌐 Verificando IP pública y proxy...", Toast.LENGTH_SHORT).show()
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    val req = Request.Builder().url("https://api.ipify.org?format=json").build()
                    val resp = httpClient.newCall(req).execute()
                    val body = resp.body?.string() ?: ""
                    val ipObj = gson.fromJson(body, JsonObject::class.java)
                    val ip = ipObj.get("ip")?.asString ?: "Desconocida"

                    withContext(Dispatchers.Main) {
                        AlertDialog.Builder(this@MainActivity)
                            .setTitle("🌐 Diagnóstico de Red e IP")
                            .setMessage("Tu dirección IP actual es:\n\n👉 $ip\n\nEstado de Conexión: Activo")
                            .setPositiveButton("Copiar IP") { _, _ ->
                                val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                clipboard.setPrimaryClip(ClipData.newPlainText("IP Proxy", ip))
                                Toast.makeText(this@MainActivity, "IP copiada al portapapeles", Toast.LENGTH_SHORT).show()
                            }
                            .setNegativeButton("Cerrar", null)
                            .show()
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(this@MainActivity, "No se pudo verificar IP: ${e.message}", Toast.LENGTH_SHORT).show()
                    }
                }
            }
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
