package com.iamax.launcher.bridge

import android.app.Activity
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.iamax.launcher.engine.CookieInjector
import com.iamax.launcher.storage.SessionStorage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.net.HttpURLConnection
import java.net.URL

class IAmaxBridge(
    private val activity: Activity,
    private val sessionStorage: SessionStorage,
    private val cookieInjector: CookieInjector,
    private val webViewProvider: () -> WebView,
    private val onNavigateToUrl: (url: String) -> Unit,
    private val onReturnToDashboard: () -> Unit
) {

    private val gson = Gson()
    private val ioScope = CoroutineScope(Dispatchers.IO)

    @JavascriptInterface
    fun handleMessage(jsonMessage: String): String {
        return try {
            val message = gson.fromJson(jsonMessage, JsonObject::class.java)
            val type = message.get("type")?.asString ?: ""
            Log.d("IAmaxBridge", "Received message type: $type")

            val response = JsonObject()

            when (type) {
                "INJECT_SESSION", "INJECT_CREDENTIALS" -> {
                    val cookiesElement = message.get("session") ?: message.get("cookies")
                    val cookiesJson = if (cookiesElement != null) gson.toJson(cookiesElement) else ""
                    val targetUrl = message.get("url")?.asString ?: message.get("targetUrl")?.asString

                    val success = cookieInjector.injectCookies(cookiesJson, targetUrl)
                    response.addProperty("success", success)

                    if (targetUrl != null && targetUrl.startsWith("http")) {
                        activity.runOnUiThread {
                            onNavigateToUrl(targetUrl)
                        }
                    }
                }

                "EXTRACT_SESSION" -> {
                    val url = message.get("url")?.asString ?: message.get("domain")?.asString ?: ""
                    val target = if (url.startsWith("http")) url else "https://$url"
                    val cookiesJson = cookieInjector.extractCookies(target)
                    response.addProperty("success", true)
                    response.add("cookies", gson.fromJson(cookiesJson, com.google.gson.JsonArray::class.java))
                }

                "CLEAR_DOMAIN_CACHE", "CLEAR_DOMAIN_CACHE_NO_COOKIES" -> {
                    val domain = message.get("domain")?.asString
                    cookieInjector.clearCookies(domain)
                    response.addProperty("success", true)
                }

                "OPEN_TOOL_WINDOW", "OPEN_TOOL" -> {
                    val url = message.get("url")?.asString ?: ""
                    if (url.isNotBlank()) {
                        activity.runOnUiThread {
                            onNavigateToUrl(url)
                        }
                    }
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
                    response.addProperty("message", "Unhandled message type: $type")
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
     * Native HTTP Fetch: executes HTTP requests with 0 CORS restrictions directly via Android networking.
     */
    @JavascriptInterface
    fun nativeFetch(urlStr: String, method: String, headersJson: String, body: String, callbackName: String) {
        ioScope.launch {
            var status = 0
            var statusText = ""
            var responseBody = ""
            val responseHeaders = mutableMapOf<String, String>()

            try {
                val url = URL(urlStr)
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = method.uppercase()
                conn.connectTimeout = 15000
                conn.readTimeout = 20000
                conn.instanceFollowRedirects = true

                // Apply headers
                if (headersJson.isNotBlank()) {
                    try {
                        val headers = gson.fromJson(headersJson, JsonObject::class.java)
                        headers.keySet().forEach { key ->
                            conn.setRequestProperty(key, headers.get(key).asString)
                        }
                    } catch (_: Exception) {}
                }

                // Write payload if POST/PUT/PATCH
                if (body.isNotBlank() && (method.equals("POST", true) || method.equals("PUT", true) || method.equals("PATCH", true))) {
                    conn.doOutput = true
                    conn.outputStream.use { os ->
                        os.write(body.toByteArray(Charsets.UTF_8))
                        os.flush()
                    }
                }

                status = conn.responseCode
                statusText = conn.responseMessage ?: ""

                conn.headerFields.forEach { (key, values) ->
                    if (key != null && values.isNotEmpty()) {
                        responseHeaders[key.lowercase()] = values.joinToString(", ")
                    }
                }

                val stream = if (status in 200..299) conn.inputStream else (conn.errorStream ?: conn.inputStream)
                responseBody = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""

            } catch (e: Exception) {
                Log.e("IAmaxBridge", "nativeFetch error: ${e.message}", e)
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
