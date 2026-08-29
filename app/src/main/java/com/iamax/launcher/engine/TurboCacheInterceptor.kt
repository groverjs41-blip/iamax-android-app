package com.iamax.launcher.engine

import android.content.Context
import android.util.Log
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

class TurboCacheInterceptor(private val context: Context) {

    private val cacheDir = File(context.cacheDir, "turbo_web_cache").apply { mkdirs() }
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    private val blockedTelemetryHosts = setOf(
        "google-analytics.com",
        "googletagmanager.com",
        "sentry.io",
        "browser-intake-datadoghq.com",
        "segment.io",
        "api.segment.io",
        "stats.grok.com",
        "telemetry.openai.com",
        "events.statsigapi.net"
    )

    fun shouldIntercept(request: WebResourceRequest): WebResourceResponse? {
        val uri = request.url ?: return null
        val urlStr = uri.toString()
        val host = uri.host?.lowercase() ?: ""

        // 1. Bloqueo de telemetría y rastreadores invisibles que ralentizan la CPU
        for (blocked in blockedTelemetryHosts) {
            if (host.contains(blocked)) {
                return WebResourceResponse("text/plain", "UTF-8", ByteArrayInputStream(ByteArray(0)))
            }
        }

        // 2. Solo cachear peticiones GET de recursos estáticos pesados
        if (!request.method.equals("GET", true)) return null

        val path = uri.path?.lowercase() ?: ""
        val isStaticAsset = path.endsWith(".js") || path.endsWith(".css") ||
                path.endsWith(".woff2") || path.endsWith(".woff") ||
                path.endsWith(".ttf") || path.endsWith(".svg") ||
                path.endsWith(".png") || path.endsWith(".webp") ||
                path.endsWith(".jpg")

        // No cachear llamadas dinámicas de APIs o tokens
        if (!isStaticAsset || path.contains("/api/") || path.contains("/auth/") || path.contains("session")) {
            return null
        }

        // 3. Revisar caché local en memoria flash del celular (0 ms de respuesta)
        val cacheKey = hashUrl(urlStr)
        val cachedFile = File(cacheDir, cacheKey)

        if (cachedFile.exists() && cachedFile.length() > 0) {
            val mimeType = getMimeType(path)
            try {
                val stream = FileInputStream(cachedFile)
                val headers = mapOf(
                    "Access-Control-Allow-Origin" to "*",
                    "Cache-Control" to "max-age=31536000, public"
                )
                return WebResourceResponse(mimeType, "UTF-8", 200, "OK", headers, stream)
            } catch (e: Exception) {
                Log.w("TurboCache", "Error reading local cache: ${e.message}")
            }
        }

        // 4. Si no está en caché, descargarlo y guardarlo en memoria rápida
        try {
            val okReq = Request.Builder().url(urlStr).build()
            val okResp = httpClient.newCall(okReq).execute()

            if (okResp.isSuccessful && okResp.body != null) {
                val bytes = okResp.body!!.bytes()
                val mimeType = okResp.header("content-type") ?: getMimeType(path)

                // Guardar en segundo plano
                try {
                    FileOutputStream(cachedFile).use { it.write(bytes) }
                } catch (_: Exception) {}

                val headers = mutableMapOf<String, String>()
                okResp.headers.forEach { pair ->
                    headers[pair.first] = pair.second
                }
                headers["Access-Control-Allow-Origin"] = "*"

                return WebResourceResponse(mimeType, "UTF-8", okResp.code, "OK", headers, ByteArrayInputStream(bytes))
            }
        } catch (e: Exception) {
            Log.d("TurboCache", "Bypass cache on error for $urlStr: ${e.message}")
        }

        return null
    }

    private fun hashUrl(url: String): String {
        val md = MessageDigest.getInstance("MD5")
        val digested = md.digest(url.toByteArray())
        return digested.joinToString("") { "%02x".format(it) }
    }

    private fun getMimeType(path: String): String {
        return when {
            path.endsWith(".js") -> "application/javascript"
            path.endsWith(".css") -> "text/css"
            path.endsWith(".woff2") -> "font/woff2"
            path.endsWith(".woff") -> "font/woff"
            path.endsWith(".ttf") -> "font/ttf"
            path.endsWith(".svg") -> "image/svg+xml"
            path.endsWith(".png") -> "image/png"
            path.endsWith(".webp") -> "image/webp"
            path.endsWith(".jpg") || path.endsWith(".jpeg") -> "image/jpeg"
            else -> "application/octet-stream"
        }
    }
}
