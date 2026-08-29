package com.iamax.launcher.bridge

import android.app.Activity
import android.net.Uri
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonObject
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
                    if (cardId.isNotBlank()) {
                        sessionStorage.setString("activeCardId", cardId)
                    }

                    var cookiesJson = ""
                    if (message.has("sessionData") && !message.get("sessionData").isJsonNull) {
                        cookiesJson = gson.toJson(message.get("sessionData"))
                    } else if (message.has("session") && !message.get("session").isJsonNull) {
                        cookiesJson = gson.toJson(message.get("session"))
                    } else if (message.has("cookies") && !message.get("cookies").isJsonNull) {
                        cookiesJson = gson.toJson(message.get("cookies"))
                    }

                    if (cookiesJson.isNotBlank()) {
                        cookieInjector.injectCookies(cookiesJson, targetUrl)
                    }

                    response.addProperty("success", true)

                    if (targetUrl.isNotBlank() && targetUrl.startsWith("http")) {
                        activity.runOnUiThread {
                            onNavigateToUrl(targetUrl)
                        }
                    }
                }

                "CLEAR_AND_OPEN" -> {
                    val targetUrl = message.get("url")?.asString ?: message.get("targetUrl")?.asString ?: ""
                    val cardId = message.get("cardId")?.asString ?: ""
                    if (cardId.isNotBlank()) {
                        sessionStorage.setString("activeCardId", cardId)
                    }

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
                            onNavigateToUrl(targetUrl)
                        }
                    }
                }

                "OPEN_TOOL_WINDOW", "OPEN_TOOL" -> {
                    val targetUrl = message.get("url")?.asString ?: ""
                    val cardId = message.get("cardId")?.asString ?: ""
                    if (cardId.isNotBlank()) {
                        sessionStorage.setString("activeCardId", cardId)
                    }

                    if (targetUrl.isNotBlank() && targetUrl.startsWith("http")) {
                        activity.runOnUiThread {
                            onNavigateToUrl(targetUrl)
                        }
                    }
                    response.addProperty("success", true)
                }

                "INJECT_CREDENTIALS" -> {
                    val cardId = message.get("cardId")?.asString ?: ""
                    if (cardId.isNotBlank()) {
                        sessionStorage.setString("activeCardId", cardId)
                    }
                    val email = message.get("email")?.asString ?: ""
                    val password = message.get("password")?.asString ?: ""
                    val totp = message.get("totpCode")?.asString ?: ""

                    if (cardId.isNotBlank()) {
                        sessionStorage.setString("pending_inject_email_$cardId", email)
                        sessionStorage.setString("pending_inject_pass_$cardId", password)
                        sessionStorage.setString("pending_inject_totp_$cardId", totp)
                    }

                    activity.runOnUiThread {
                        credentialInjectorService.injectCredentials(toolWebViewProvider())
                    }

                    response.addProperty("success", true)
                    response.addProperty("message", "Inyectando credenciales del perfil...")
                }

                "AUTO_INJECT_NOW" -> {
                    val cardId = message.get("cardId")?.asString ?: ""
                    if (cardId.isNotBlank()) {
                        sessionStorage.setString("activeCardId", cardId)
                    }
                    activity.runOnUiThread {
                        credentialInjectorService.injectCredentials(toolWebViewProvider())
                    }
                    response.addProperty("success", true)
                }

                "SET_PROFILE_MODULES" -> {
                    val modules = message.get("modules") ?: JsonArray()
                    response.addProperty("success", true)
                    response.add("modules", modules)
                }

                "GET_PROFILE_MODULES" -> {
                    val modules = JsonArray().apply {
                        add("core")
                        add("session")
                        add("injector")
                        add("shield")
                        add("clear-cache")
                    }
                    response.addProperty("success", true)
                    response.add("modules", modules)
                }

                "GET_PENDING_INJECT_STATE" -> {
                    val activeId = sessionStorage.getString("activeCardId", "")
                    response.addProperty("success", true)
                    response.addProperty("isOwner", false)
                    response.addProperty("clientCanInject", true)
                    response.addProperty("clientInjectMethod", "google")
                    response.addProperty("pendingInjectCardId", activeId)
                }

                "SET_BLOCKED_SELECTORS", "REVOKE_ACCESS_STATE", "RELOAD_INCOGNITO" -> {
                    response.addProperty("success", true)
                }

                "EXTRACT_SESSION" -> {
                    val url = message.get("url")?.asString ?: message.get("domain")?.asString ?: ""
                    val target = if (url.startsWith("http")) url else "https://$url"
                    val cookiesJson = cookieInjector.extractCookies(target)
                    response.addProperty("success", true)
                    response.add("cookies", gson.fromJson(cookiesJson, JsonArray::class.java))
                }

                "CLEAR_DOMAIN_CACHE", "CLEAR_DOMAIN_CACHE_NO_COOKIES" -> {
                    val urlOrDomain = message.get("url")?.asString ?: message.get("domain")?.asString ?: ""
                    val domain = if (urlOrDomain.startsWith("http")) {
                        Uri.parse(urlOrDomain).host
                    } else {
                        urlOrDomain
                    }
                    cookieInjector.clearCookies(domain)
                    response.addProperty("success", true)
                }

                "NAVIGATE_DASHBOARD" -> {
                    activity.runOnUiThread {
                        onReturnToDashboard()
                    }
                    response.addProperty("success", true)
                }

                "GET_STORAGE" -> {
                    val key = message.get("key")?.asString ?: ""
                    val value = sessionStorage.getString(key, "")
                    response.addProperty("key", key)
                    response.addProperty("value", value)
                    response.addProperty("success", true)
                }

                "SET_STORAGE" -> {
                    val key = message.get("key")?.asString ?: ""
                    val value = message.get("value")?.asString ?: ""
                    sessionStorage.setString(key, value)
                    response.addProperty("success", true)
                }

                "REMOVE_STORAGE" -> {
                    val key = message.get("key")?.asString ?: ""
                    sessionStorage.remove(key)
                    response.addProperty("success", true)
                }

                "GET_ALL_STORAGE" -> {
                    val all = sessionStorage.getAll()
                    response.add("data", gson.toJsonTree(all))
                    response.addProperty("success", true)
                }

                else -> {
                    response.addProperty("success", true)
                    response.addProperty("message", "Processed $type")
                }
            }

            gson.toJson(response)
        } catch (e: Exception) {
            Log.e("IAmaxBridge", "Error in handleMessage: ${e.message}", e)
            val err = JsonObject()
            err.addProperty("success", false)
            err.addProperty("error", e.message)
            gson.toJson(err)
        }
    }

    /**
     * High Performance Native HTTP Fetch using OkHttpClient (Handles TLS 1.3, HTTP/2, GZIP auto-decompression, Zero-CORS)
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
    fun getStoredItem(key: String): String {
        return sessionStorage.getString(key, "")
    }

    @JavascriptInterface
    fun setStoredItem(key: String, value: String) {
        sessionStorage.setString(key, value)
    }

    @JavascriptInterface
    fun removeStoredItem(key: String) {
        sessionStorage.remove(key)
    }

    @JavascriptInterface
    fun isAndroidApp(): Boolean {
        return true
    }

    @JavascriptInterface
    fun log(msg: String) {
        Log.d("IAmaxJS", msg)
    }
}
