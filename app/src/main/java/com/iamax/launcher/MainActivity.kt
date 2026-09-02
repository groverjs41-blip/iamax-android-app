package com.iamax.launcher

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.util.Log
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

    private var pendingDownloadData: ByteArray? = null
    private var pendingDownloadFileName: String = ""
    private var pendingDownloadMimeType: String = ""

    private val createDocumentLauncher = registerForActivityResult(
        ActivityResultContracts.CreateDocument("*/*")
    ) { uri: Uri? ->
        val data = pendingDownloadData
        if (uri != null && data != null) {
            try {
                contentResolver.openOutputStream(uri)?.use { os ->
                    os.write(data)
                }
                Toast.makeText(this, "Guardado exitosamente: $pendingDownloadFileName", Toast.LENGTH_LONG).show()
                MediaScannerConnection.scanFile(this, arrayOf(uri.path), arrayOf(pendingDownloadMimeType), null)
            } catch (e: Exception) {
                Log.e("MainActivity", "Error saving document: ${e.message}", e)
                Toast.makeText(this, "Error al guardar: ${e.message}", Toast.LENGTH_SHORT).show()
            } finally {
                pendingDownloadData = null
            }
        } else {
            pendingDownloadData = null
        }
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

        // Menú contextual para descargar imágenes, videos o audios al mantener presionado
        webView.setOnLongClickListener {
            val result = webView.hitTestResult
            val extra = result.extra
            if (extra.isNullOrBlank()) return@setOnLongClickListener false

            when (result.type) {
                WebView.HitTestResult.IMAGE_TYPE,
                WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE -> {
                    downloadUrlWithAuth(extra, "", "image/png")
                    true
                }
                WebView.HitTestResult.SRC_ANCHOR_TYPE -> {
                    val lower = extra.lowercase()
                    if (lower.endsWith(".mp3") || lower.endsWith(".ogg") || lower.endsWith(".mp4") || lower.endsWith(".pdf") ||
                        lower.endsWith(".zip") || lower.endsWith(".wav") || lower.endsWith(".xlsx") ||
                        lower.endsWith(".csv") || lower.endsWith(".webm") || lower.contains("download")) {
                        downloadUrlWithAuth(extra, "", "")
                        true
                    } else false
                }
                else -> false
            }
        }

        // Descargas del WebView (Handles HTTP, HTTPS, blob:, y data: URIs)
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

                val fileName = URLUtil.guessFileName(url, contentDisposition, mimeType)
                downloadUrlWithAuth(url, fileName, mimeType)
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
        downloadUrlWithAuth(url, suggestedFileName, "")
    }

    fun promptUserWhereToSave(bytes: ByteArray, fileName: String, mimeType: String) {
        runOnUiThread {
            try {
                val safeName = sanitizeFileName(fileName, mimeType)
                val resolvedMime = resolveMimeType(safeName, mimeType)
                val sizeText = formatFileSize(bytes.size.toLong())

                val options = arrayOf(
                    "📁 Elegir carpeta (Selector de Android)...",
                    "📥 Guardar directo en Descargas"
                )

                AlertDialog.Builder(this)
                    .setTitle("Guardar archivo")
                    .setMessage("Archivo: $safeName\nTamaño: $sizeText\n\n¿Dónde deseas guardar el archivo?")
                    .setItems(options) { _, which ->
                        when (which) {
                            0 -> {
                                pendingDownloadData = bytes
                                pendingDownloadFileName = safeName
                                pendingDownloadMimeType = resolvedMime
                                createDocumentLauncher.launch(safeName)
                            }
                            1 -> {
                                saveToDownloadsDir(bytes, safeName, resolvedMime)
                            }
                        }
                    }
                    .setNegativeButton("Cancelar", null)
                    .show()
            } catch (e: Exception) {
                Log.e("MainActivity", "Error in promptUserWhereToSave: ${e.message}", e)
                saveToDownloadsDir(bytes, fileName, mimeType)
            }
        }
    }

    fun saveToDownloadsDir(bytes: ByteArray, fileName: String, mimeType: String) {
        try {
            val safeName = sanitizeFileName(fileName, mimeType)
            val resolvedMime = resolveMimeType(safeName, mimeType)

            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                val values = android.content.ContentValues().apply {
                    put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, safeName)
                    put(android.provider.MediaStore.MediaColumns.MIME_TYPE, resolvedMime)
                    put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                }
                val uri = contentResolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                if (uri != null) {
                    contentResolver.openOutputStream(uri)?.use { os -> os.write(bytes) }
                }
            } else {
                val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                dir.mkdirs()
                val file = java.io.File(dir, safeName)
                file.outputStream().use { os -> os.write(bytes) }
                MediaScannerConnection.scanFile(this, arrayOf(file.absolutePath), arrayOf(resolvedMime), null)
            }
            Toast.makeText(this, "Guardado en Descargas: $safeName", Toast.LENGTH_LONG).show()
        } catch (e: Exception) {
            Log.e("MainActivity", "Error saving to Downloads: ${e.message}", e)
            Toast.makeText(this, "Error al guardar: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    fun downloadUrlWithAuth(url: String, suggestedName: String, mimeType: String) {
        if (url.startsWith("data:")) {
            try {
                val commaIdx = url.indexOf(',')
                val raw = if (commaIdx != -1) url.substring(commaIdx + 1) else url
                val bytes = android.util.Base64.decode(raw, android.util.Base64.DEFAULT)
                val guessedName = if (suggestedName.isNotBlank()) suggestedName else "imagen_${System.currentTimeMillis()}.png"
                promptUserWhereToSave(bytes, guessedName, mimeType)
            } catch (e: Exception) {
                Toast.makeText(this, "Error al procesar datos: ${e.message}", Toast.LENGTH_SHORT).show()
            }
            return
        }

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val initialName = if (suggestedName.isNotBlank()) suggestedName else URLUtil.guessFileName(url, null, null)
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@MainActivity, "Descargando: $initialName...", Toast.LENGTH_SHORT).show()
                }
                val cookies = CookieManager.getInstance().getCookie(url) ?: ""
                val reqBuilder = Request.Builder()
                    .url(url)
                    .addHeader("User-Agent", cleanMobileUserAgent)
                if (cookies.isNotBlank()) {
                    reqBuilder.addHeader("Cookie", cookies)
                }
                val response = httpClient.newCall(reqBuilder.build()).execute()
                if (!response.isSuccessful) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(this@MainActivity, "Error en descarga (${response.code})", Toast.LENGTH_SHORT).show()
                    }
                    return@launch
                }
                val bytes = response.body?.bytes() ?: return@launch
                val headerDisposition = response.header("Content-Disposition")
                val finalName = if (suggestedName.isNotBlank() && suggestedName.contains(".")) {
                    suggestedName
                } else {
                    URLUtil.guessFileName(url, headerDisposition, response.header("Content-Type") ?: mimeType)
                }
                val respMime = response.header("Content-Type") ?: mimeType

                withContext(Dispatchers.Main) {
                    promptUserWhereToSave(bytes, finalName, respMime)
                }
            } catch (e: Exception) {
                Log.e("MainActivity", "Download error: ${e.message}", e)
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@MainActivity, "Error al descargar: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun sanitizeFileName(fileName: String, mimeType: String): String {
        val lowerMime = mimeType.lowercase()
        val safe = if (fileName.isNotBlank()) fileName else "descarga_${System.currentTimeMillis()}"
        if (safe.contains(".")) return safe
        return when {
            lowerMime.contains("audio/ogg") || lowerMime.contains("opus") || lowerMime.contains("ogg") -> "$safe.ogg"
            lowerMime.contains("audio/mpeg") || lowerMime.contains("mp3") -> "$safe.mp3"
            lowerMime.contains("audio/wav") || lowerMime.contains("wav") -> "$safe.wav"
            lowerMime.contains("audio/mp4") || lowerMime.contains("m4a") -> "$safe.m4a"
            lowerMime.contains("video/mp4") || lowerMime.contains("mp4") -> "$safe.mp4"
            lowerMime.contains("video/webm") || lowerMime.contains("webm") -> "$safe.webm"
            lowerMime.contains("image/png") || lowerMime.contains("png") -> "$safe.png"
            lowerMime.contains("image/jpeg") || lowerMime.contains("jpg") -> "$safe.jpg"
            lowerMime.contains("image/webp") || lowerMime.contains("webp") -> "$safe.webp"
            lowerMime.contains("image/gif") || lowerMime.contains("gif") -> "$safe.gif"
            lowerMime.contains("pdf") -> "$safe.pdf"
            lowerMime.contains("json") -> "$safe.json"
            lowerMime.contains("csv") -> "$safe.csv"
            lowerMime.contains("zip") -> "$safe.zip"
            lowerMime.contains("excel") || lowerMime.contains("spreadsheet") -> "$safe.xlsx"
            else -> "$safe.bin"
        }
    }

    private fun resolveMimeType(fileName: String, fallbackMime: String): String {
        val lower = fileName.lowercase()
        return when {
            lower.endsWith(".ogg") -> "audio/ogg"
            lower.endsWith(".mp3") -> "audio/mpeg"
            lower.endsWith(".wav") -> "audio/wav"
            lower.endsWith(".m4a") -> "audio/mp4"
            lower.endsWith(".mp4") -> "video/mp4"
            lower.endsWith(".webm") -> "video/webm"
            lower.endsWith(".png") -> "image/png"
            lower.endsWith(".jpg") || lower.endsWith(".jpeg") -> "image/jpeg"
            lower.endsWith(".webp") -> "image/webp"
            lower.endsWith(".gif") -> "image/gif"
            lower.endsWith(".pdf") -> "application/pdf"
            lower.endsWith(".json") -> "application/json"
            lower.endsWith(".csv") -> "text/csv"
            lower.endsWith(".xlsx") -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            lower.endsWith(".zip") -> "application/zip"
            fallbackMime.isNotBlank() -> fallbackMime
            else -> "application/octet-stream"
        }
    }

    private fun formatFileSize(size: Long): String {
        if (size <= 0) return "0 B"
        val units = arrayOf("B", "KB", "MB", "GB")
        val digitGroups = (Math.log10(size.toDouble()) / Math.log10(1024.0)).toInt()
        val num = size / Math.pow(1024.0, digitGroups.toDouble())
        return String.format("%.1f %s", num, units[digitGroups])
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
