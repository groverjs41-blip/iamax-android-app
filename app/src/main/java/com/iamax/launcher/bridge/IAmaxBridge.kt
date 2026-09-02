package com.iamax.launcher.bridge

import android.app.Activity
import android.net.Uri
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebStorage
import android.webkit.WebView
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.iamax.launcher.MainActivity
import com.iamax.launcher.engine.CookieInjector
import com.iamax.launcher.engine.CredentialInjectorService
import com.iamax.launcher.storage.SessionStorage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

class IAmaxBridge(
    private val activity: Activity,
    private val sessionStorage: SessionStorage,
    private val cookieInjector: CookieInjector,
    private val credentialInjectorService: CredentialInjectorService,
    private val webViewProvider: () -> WebView,
    private val toolWebViewProvider: () -> WebView,
    private val onApplyUserAgent: (userAgent: String) -> Unit = {},
    private val onNavigateToUrl: (url: String) -> Unit,
    private val onReturnToDashboard: () -> Unit
) {

    private val gson = Gson()
    private val ioScope = CoroutineScope(Dispatchers.IO)
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    private val defaultDesktopUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

    private fun resolveOptimalUserAgent(targetUrl: String, cardUserAgent: String?): String {
        val lower = targetUrl.lowercase()
        val isGoogle = lower.contains("accounts.google.") || 
                       lower.contains("google.com") || 
                       lower.contains("google.") ||
                       lower.contains("youtube.com") ||
                       lower.contains("gmail.com")

        // Para Google (incluyendo cualquier card con OAuth de Google como Nano Banana):
        // NUNCA enviar User-Agent de Windows Desktop ni WebView (; wv).
        // Se debe usar siempre el User-Agent limpio nativo de Chrome Android.
        if (isGoogle) {
            return MainActivity.cleanMobileUserAgent.ifBlank {
                "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36"
            }
        }

        // Si la tarjeta trae un UA explícito no-Google configurado
        if (!cardUserAgent.isNullOrBlank() && !cardUserAgent.contains("Google", ignoreCase = true)) {
            return cardUserAgent
        }

        // Para IAs conocidas que admiten desktop (ChatGPT, Claude, Grok)
        if (lower.contains("chatgpt.com") || lower.contains("openai.com") || 
            lower.contains("claude.ai") || lower.contains("grok.com")) {
            return defaultDesktopUserAgent
        }

        // Para cualquier otra herramienta, usar el User-Agent limpio nativo de Chrome
        return MainActivity.cleanMobileUserAgent.ifBlank {
            "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36"
        }
    }

    private fun clearGoogleSessionState(targetUrl: String, loginMethod: String?) {
        val lowerUrl = targetUrl.lowercase()
        val isGoogle = (loginMethod != null && loginMethod.equals("google", ignoreCase = true)) ||
                       lowerUrl.contains("accounts.google.") ||
                       lowerUrl.contains("google.com") ||
                       lowerUrl.contains("google.") ||
                       lowerUrl.contains("youtube.com") ||
                       lowerUrl.contains("gemini.google") ||
                       lowerUrl.contains("nanobanana")

        if (isGoogle) {
            Log.d("IAmaxBridge", "Isolating Google profile: clearing previous Google account cookies & storage")
            cookieInjector.clearGoogleSession()
            activity.runOnUiThread {
                try {
                    val ws = WebStorage.getInstance()
                    ws.deleteOrigin("https://accounts.google.com")
                    ws.deleteOrigin("https://google.com")
                    ws.deleteOrigin("https://www.google.com")
                    ws.deleteOrigin("https://myaccount.google.com")
                    ws.deleteOrigin("https://gemini.google.com")
                    ws.deleteOrigin("https://youtube.com")
                } catch (e: Exception) {
                    Log.w("IAmaxBridge", "Error deleting Google web storage: ${e.message}")
                }
            }
        }
    }

    @JavascriptInterface
    fun handleMessage(jsonMessage: String): String {
        return try {
            val message = gson.fromJson(jsonMessage, JsonObject::class.java)
            val type = message.get("type")?.asString ?: ""
            Log.d("IAmaxBridge", "Received message type: $type")

            val response = JsonObject()

            when (type) {
                "INJECT_SESSION" -> {
                    val targetUrl = message.get("url")?.asString ?: message.get("targetUrl")?.asString ?: ""
                    val cardId = message.get("cardId")?.asString ?: ""
                    val userAgent = message.get("userAgent")?.asString ?: ""
                    val loginMethod = message.get("loginMethod")?.asString ?: message.get("clientInjectMethod")?.asString ?: ""
                    if (cardId.isNotBlank()) {
                        sessionStorage.setString("activeCardId", cardId)
                    }
                    clearGoogleSessionState(targetUrl, loginMethod)

                    var cookiesJson = ""
                    var lsJson = ""
                    var ssJson = ""
                    var cookieCount = 0

                    if (message.has("sessionData") && !message.get("sessionData").isJsonNull) {
                        val sd = message.get("sessionData")
                        if (sd.isJsonObject) {
                            val obj = sd.asJsonObject
                            if (obj.has("cookies_json")) cookiesJson = obj.get("cookies_json").asString
                            if (obj.has("local_storage_json")) lsJson = obj.get("local_storage_json").asString
                            if (obj.has("session_storage_json")) ssJson = obj.get("session_storage_json").asString
                        } else {
                            cookiesJson = gson.toJson(sd)
                        }
                    } else if (message.has("session") && !message.get("session").isJsonNull) {
                        cookiesJson = gson.toJson(message.get("session"))
                    } else if (message.has("cookies") && !message.get("cookies").isJsonNull) {
                        cookiesJson = gson.toJson(message.get("cookies"))
                    }

                    // En IAmax 1.3.9 el dashboard envía sessionData: null y fetchSession: true
                    // Descargamos la sesión completa (cookies + localStorage + sessionStorage) directamente del servidor
                    if (cookiesJson.isBlank() && cardId.isNotBlank()) {
                        val ownerToken = sessionStorage.getString("ownerToken", "").ifBlank {
                            sessionStorage.getString("sess_ownerToken", "").ifBlank {
                                sessionStorage.getString("session_ownerToken", "")
                            }
                        }
                        val guestPassword = sessionStorage.getString("guestPassword", "").ifBlank {
                            sessionStorage.getString("sess_guestPassword", "").ifBlank {
                                sessionStorage.getString("session_guestPassword", "")
                            }
                        }

                        try {
                            Log.d("IAmaxBridge", "Fetching session for cardId: $cardId from server...")
                            val reqBuilder = Request.Builder()
                                .url("https://iamaxbotcrm.online/api/sessions/download/$cardId")
                            if (ownerToken.isNotBlank()) {
                                reqBuilder.header("Authorization", "Bearer $ownerToken")
                            }
                            if (guestPassword.isNotBlank()) {
                                reqBuilder.header("X-Guest-Password", guestPassword)
                            }
                            val callResp = httpClient.newCall(reqBuilder.build()).execute()
                            if (callResp.isSuccessful) {
                                val bodyStr = callResp.body?.string() ?: ""
                                val sessObj = gson.fromJson(bodyStr, JsonObject::class.java)
                                if (sessObj != null) {
                                    if (sessObj.has("cookies_json")) {
                                        val cj = sessObj.get("cookies_json")
                                        cookiesJson = if (cj.isJsonPrimitive) cj.asString else gson.toJson(cj)
                                    } else if (sessObj.has("cookies")) {
                                        cookiesJson = gson.toJson(sessObj.get("cookies"))
                                    }
                                    if (sessObj.has("local_storage_json")) {
                                        val lj = sessObj.get("local_storage_json")
                                        lsJson = if (lj.isJsonPrimitive) lj.asString else gson.toJson(lj)
                                    }
                                    if (sessObj.has("session_storage_json")) {
                                        val sj = sessObj.get("session_storage_json")
                                        ssJson = if (sj.isJsonPrimitive) sj.asString else gson.toJson(sj)
                                    }
                                    Log.d("IAmaxBridge", "Downloaded session successfully for $cardId")
                                }
                            } else {
                                Log.w("IAmaxBridge", "Failed to download session: HTTP ${callResp.code}")
                            }
                        } catch (e: Exception) {
                            Log.e("IAmaxBridge", "Exception downloading session for $cardId: ${e.message}", e)
                        }
                    }

                    if (cookiesJson.isNotBlank()) {
                        cookieCount = cookieInjector.injectCookiesCount(cookiesJson, targetUrl)
                    }

                    if (lsJson.isNotBlank()) {
                        sessionStorage.setString("pending_ls_$cardId", lsJson)
                    }
                    if (ssJson.isNotBlank()) {
                        sessionStorage.setString("pending_ss_$cardId", ssJson)
                    }

                    response.addProperty("success", true)
                    response.addProperty("sessionRestored", true)
                    response.addProperty("sessionVerified", true)
                    response.addProperty("cookieCount", cookieCount)

                    if (targetUrl.isNotBlank() && targetUrl.startsWith("http")) {
                        activity.runOnUiThread {
                            val finalUa = resolveOptimalUserAgent(targetUrl, userAgent)
                            onApplyUserAgent(finalUa)
                            onNavigateToUrl(targetUrl)
                        }
                    }
                }

                "CLEAR_AND_OPEN" -> {
                    val targetUrl = message.get("url")?.asString ?: message.get("targetUrl")?.asString ?: ""
                    val cardId = message.get("cardId")?.asString ?: ""
                    val userAgent = message.get("userAgent")?.asString ?: ""
                    val loginMethod = message.get("loginMethod")?.asString ?: message.get("clientInjectMethod")?.asString ?: ""
                    if (cardId.isNotBlank()) {
                        sessionStorage.setString("activeCardId", cardId)
                    }
                    clearGoogleSessionState(targetUrl, loginMethod)

                    val dontClear = message.get("dontClearCookies")?.asBoolean ?: false
                    if (!dontClear && targetUrl.isNotBlank()) {
                        try {
                            val domain = Uri.parse(targetUrl).host
                            cookieInjector.clearCookies(domain)
                        } catch (_: Exception) {}
                    }

                    response.addProperty("success", true)

                    if (targetUrl.isNotBlank() && targetUrl.startsWith("http")) {
                        activity.runOnUiThread {
                            val finalUa = resolveOptimalUserAgent(targetUrl, userAgent)
                            onApplyUserAgent(finalUa)
                            onNavigateToUrl(targetUrl)
                        }
                    }
                }

                "OPEN_TOOL_WINDOW", "OPEN_TOOL" -> {
                    val targetUrl = message.get("url")?.asString ?: ""
                    val cardId = message.get("cardId")?.asString ?: ""
                    val userAgent = message.get("userAgent")?.asString ?: ""
                    val loginMethod = message.get("loginMethod")?.asString ?: message.get("clientInjectMethod")?.asString ?: ""
                    if (cardId.isNotBlank()) {
                        sessionStorage.setString("activeCardId", cardId)
                    }
                    clearGoogleSessionState(targetUrl, loginMethod)

                    response.addProperty("success", true)

                    if (targetUrl.isNotBlank() && targetUrl.startsWith("http")) {
                        activity.runOnUiThread {
                            val finalUa = resolveOptimalUserAgent(targetUrl, userAgent)
                            onApplyUserAgent(finalUa)
                            onNavigateToUrl(targetUrl)
                        }
                    }
                }

                "AUTO_INJECT_NOW", "INJECT_CREDENTIALS" -> {
                    val reqCardId = message.get("cardId")?.asString ?: ""
                    if (reqCardId.isNotBlank()) {
                        sessionStorage.setString("activeCardId", reqCardId)
                    }
                    activity.runOnUiThread {
                        val toolView = toolWebViewProvider()
                        credentialInjectorService.injectCredentials(toolView)
                    }
                    response.addProperty("success", true)
                }

                "GET_STORED_ITEM" -> {
                    val key = message.get("key")?.asString ?: ""
                    val value = sessionStorage.getString(key, "")
                    response.addProperty("value", value)
                }

                "SET_STORED_ITEM" -> {
                    val key = message.get("key")?.asString ?: ""
                    val value = message.get("value")?.asString ?: ""
                    sessionStorage.setString(key, value)
                    response.addProperty("success", true)
                }

                "REMOVE_STORED_ITEM" -> {
                    val key = message.get("key")?.asString ?: ""
                    sessionStorage.remove(key)
                    response.addProperty("success", true)
                }

                "CLEAR_STORAGE" -> {
                    sessionStorage.clear()
                    response.addProperty("success", true)
                }

                "GET_ALL_STORAGE" -> {
                    val all = sessionStorage.getAll()
                    val dataObj = JsonObject()
                    all.forEach { (k, v) ->
                        dataObj.addProperty(k, v.toString())
                    }
                    response.add("data", dataObj)
                }

                "CLOSE_WINDOW", "RETURN_TO_DASHBOARD" -> {
                    activity.runOnUiThread {
                        onReturnToDashboard()
                    }
                    response.addProperty("success", true)
                }

                else -> {
                    Log.w("IAmaxBridge", "Unhandled message type: $type")
                    response.addProperty("warning", "Unhandled message type: $type")
                    response.addProperty("success", true)
                }
            }

            gson.toJson(response)
        } catch (e: Exception) {
            Log.e("IAmaxBridge", "Error handling message: ${e.message}", e)
            val errResponse = JsonObject()
            errResponse.addProperty("error", e.message)
            gson.toJson(errResponse)
        }
    }

    @JavascriptInterface
    fun getStoredItem(key: String): String? {
        val value = sessionStorage.getString(key, "")
        return if (value.isBlank()) null else value
    }

    @JavascriptInterface
    fun setStoredItem(key: String, value: String) {
        sessionStorage.setString(key, value)
    }

    @JavascriptInterface
    fun removeStoredItem(key: String) {
        sessionStorage.remove(key)
    }

    /**
     * High Performance Native HTTP Fetch using OkHttpClient (Handles TLS 1.3, HTTP/2, GZIP auto-decompression, Zero-CORS)
     * Called by chrome_shim.js with 5 parameters: url, method, headersJson, body, callbackName
     */
    @JavascriptInterface
    fun nativeFetch(urlStr: String, method: String, headersJson: String, body: String, callbackName: String) {
        ioScope.launch {
            var status = 0
            var statusText = ""
            var responseBody = ""
            val responseHeaders = mutableMapOf<String, String>()

            try {
                val reqBuilder = Request.Builder().url(urlStr)
                val cleanMethod = method.trim().uppercase()

                // Apply headers
                if (headersJson.isNotBlank()) {
                    try {
                        val headersObj = gson.fromJson(headersJson, JsonObject::class.java)
                        headersObj.keySet().forEach { key ->
                            val elem = headersObj.get(key)
                            val value = if (elem.isJsonPrimitive) elem.asString else elem.toString()
                            if (key.isNotBlank() && value.isNotBlank()) {
                                reqBuilder.header(key, value)
                            }
                        }
                    } catch (_: Exception) {}
                }

                // Apply Request Body if needed
                val mediaType = "application/json; charset=utf-8".toMediaTypeOrNull()
                when (cleanMethod) {
                    "POST" -> reqBuilder.post(body.toRequestBody(mediaType))
                    "PUT" -> reqBuilder.put(body.toRequestBody(mediaType))
                    "PATCH" -> reqBuilder.patch(body.toRequestBody(mediaType))
                    "DELETE" -> {
                        if (body.isNotBlank()) reqBuilder.delete(body.toRequestBody(mediaType))
                        else reqBuilder.delete()
                    }
                    "HEAD" -> reqBuilder.head()
                    else -> reqBuilder.get()
                }

                val response = httpClient.newCall(reqBuilder.build()).execute()
                status = response.code
                statusText = response.message.ifBlank { if (status in 200..299) "OK" else "Error" }

                response.headers.forEach { pair ->
                    responseHeaders[pair.first.lowercase()] = pair.second
                }

                responseBody = response.body?.string() ?: ""

            } catch (e: Exception) {
                Log.e("IAmaxBridge", "nativeFetch error on $urlStr: ${e.message}", e)
                status = 500
                statusText = e.message ?: "Network Error"
                responseBody = "{\"error\": \"${e.message}\"}"
            }

            val respObj = JsonObject().apply {
                addProperty("status", status)
                addProperty("statusText", statusText)
                addProperty("body", responseBody)
                add("headers", gson.toJsonTree(responseHeaders))
            }
            val safeJson = gson.toJson(respObj)

            activity.runOnUiThread {
                try {
                    val js = "if (window['$callbackName']) { window['$callbackName']($safeJson); }"
                    webViewProvider().evaluateJavascript(js, null)
                } catch (e: Exception) {
                    Log.e("IAmaxBridge", "Callback invocation error: ${e.message}")
                }
            }
        }
    }

    @JavascriptInterface
    fun nativeFetch(url: String, optionsJson: String): String {
        return try {
            val options = try {
                gson.fromJson(optionsJson, JsonObject::class.java)
            } catch (_: Exception) {
                JsonObject()
            }

            val method = options.get("method")?.asString?.uppercase() ?: "GET"
            val headersObj = if (options.has("headers") && options.get("headers").isJsonObject) {
                options.getAsJsonObject("headers")
            } else {
                JsonObject()
            }

            val requestBuilder = Request.Builder().url(url)

            headersObj.keySet().forEach { key ->
                val value = headersObj.get(key).asString
                requestBuilder.header(key, value)
            }

            if (options.has("body") && !options.get("body").isJsonNull) {
                val bodyContent = options.get("body").asString
                val contentType = headersObj.get("Content-Type")?.asString
                    ?: headersObj.get("content-type")?.asString
                    ?: "application/json; charset=utf-8"
                val mediaType = contentType.toMediaTypeOrNull()
                val requestBody = bodyContent.toRequestBody(mediaType)
                requestBuilder.method(method, requestBody)
            } else if (method == "POST" || method == "PUT" || method == "PATCH") {
                val emptyBody = "".toRequestBody("application/json; charset=utf-8".toMediaTypeOrNull())
                requestBuilder.method(method, emptyBody)
            } else {
                requestBuilder.method(method, null)
            }

            val response = httpClient.newCall(requestBuilder.build()).execute()
            val responseBody = response.body?.string() ?: ""

            val result = JsonObject()
            result.addProperty("status", response.code)
            result.addProperty("statusText", response.message)
            result.addProperty("ok", response.isSuccessful)
            result.addProperty("body", responseBody)

            val respHeaders = JsonObject()
            for (i in 0 until response.headers.size) {
                respHeaders.addProperty(response.headers.name(i), response.headers.value(i))
            }
            result.add("headers", respHeaders)

            gson.toJson(result)
        } catch (e: Exception) {
            Log.e("IAmaxBridge", "nativeFetch error for $url: ${e.message}", e)
            val errorResult = JsonObject()
            errorResult.addProperty("status", 0)
            errorResult.addProperty("statusText", e.message ?: "Network Error")
            errorResult.addProperty("ok", false)
            errorResult.addProperty("body", "")
            errorResult.addProperty("error", e.message)
            gson.toJson(errorResult)
        }
    }
}
