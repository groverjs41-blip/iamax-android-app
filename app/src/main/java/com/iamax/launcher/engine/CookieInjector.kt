package com.iamax.launcher.engine

import android.net.Uri
import android.util.Log
import android.webkit.CookieManager
import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject

class CookieInjector {

    private val cookieManager: CookieManager = CookieManager.getInstance()
    private val gson = Gson()

    init {
        cookieManager.setAcceptCookie(true)
    }

    /**
     * Injects a list of cookies into the Android CookieManager for a target domain/url.
     * Supports array of cookie objects, cookies_json string, sessionData object, or raw cookie strings.
     */
    fun injectCookies(cookiesJson: String, targetUrl: String? = null): Boolean {
        if (cookiesJson.isBlank()) return false

        try {
            val jsonElement = gson.fromJson(cookiesJson, JsonElement::class.java)

            if (jsonElement.isJsonArray) {
                injectJsonArray(jsonElement.asJsonArray, targetUrl)
            } else if (jsonElement.isJsonObject) {
                val obj = jsonElement.asJsonObject
                if (obj.has("cookies_json") && obj.get("cookies_json").isJsonPrimitive) {
                    val innerJson = obj.get("cookies_json").asString
                    try {
                        val innerElement = gson.fromJson(innerJson, JsonElement::class.java)
                        if (innerElement.isJsonArray) {
                            injectJsonArray(innerElement.asJsonArray, targetUrl)
                        }
                    } catch (_: Exception) {}
                } else if (obj.has("cookies") && obj.get("cookies").isJsonArray) {
                    injectJsonArray(obj.get("cookies").asJsonArray, targetUrl)
                } else if (obj.has("name") && obj.has("value")) {
                    injectCookieObject(obj, targetUrl)
                } else {
                    // Inject key-values as cookies
                    obj.keySet().forEach { key ->
                        val value = obj.get(key)?.asString ?: ""
                        injectRawCookie("$key=$value", targetUrl)
                    }
                }
            } else if (jsonElement.isJsonPrimitive && jsonElement.asJsonPrimitive.isString) {
                val str = jsonElement.asString
                if (str.startsWith("[") || str.startsWith("{")) {
                    return injectCookies(str, targetUrl)
                } else {
                    injectRawCookie(str, targetUrl)
                }
            }

            cookieManager.flush()
            Log.d("CookieInjector", "Cookies injected successfully for $targetUrl")
            return true
        } catch (e: Exception) {
            Log.e("CookieInjector", "Error injecting cookies: ${e.message}", e)
            return false
        }
    }

    private fun injectJsonArray(array: JsonArray, targetUrl: String?) {
        for (item in array) {
            if (item.isJsonObject) {
                injectCookieObject(item.asJsonObject, targetUrl)
            } else if (item.isJsonPrimitive && item.asJsonPrimitive.isString) {
                injectRawCookie(item.asString, targetUrl)
            }
        }
    }

    private fun injectCookieObject(cookie: JsonObject, fallbackUrl: String?) {
        val name = cookie.get("name")?.asString ?: return
        val value = cookie.get("value")?.asString ?: ""
        var domain = cookie.get("domain")?.asString ?: ""
        val path = cookie.get("path")?.asString ?: "/"
        val secure = if (cookie.has("secure")) cookie.get("secure").asBoolean else true
        val httpOnly = if (cookie.has("httpOnly")) cookie.get("httpOnly").asBoolean else false
        val sameSite = cookie.get("sameSite")?.asString

        if (domain.isBlank() && fallbackUrl != null) {
            try {
                domain = Uri.parse(fallbackUrl).host ?: ""
            } catch (_: Exception) {}
        }

        val domainClean = domain.removePrefix(".")
        val targetUrl = if (domainClean.isNotEmpty()) {
            (if (secure) "https://" else "http://") + domainClean + path
        } else {
            fallbackUrl ?: "https://localhost/"
        }

        val sb = StringBuilder()
        sb.append("$name=$value")
        if (domain.isNotEmpty()) sb.append("; Domain=$domain")
        sb.append("; Path=$path")
        if (secure) sb.append("; Secure")
        if (httpOnly) sb.append("; HttpOnly")
        if (!sameSite.isNullOrBlank() && !sameSite.equals("no_restriction", ignoreCase = true) && !sameSite.equals("unspecified", ignoreCase = true)) {
            sb.append("; SameSite=$sameSite")
        }

        val cookieStr = sb.toString()
        cookieManager.setCookie(targetUrl, cookieStr)
        if (!fallbackUrl.isNullOrBlank() && fallbackUrl != targetUrl) {
            cookieManager.setCookie(fallbackUrl, cookieStr)
        }
    }

    private fun injectRawCookie(rawCookie: String, targetUrl: String?) {
        val url = targetUrl ?: "https://localhost/"
        cookieManager.setCookie(url, rawCookie)
    }

    /**
     * Extracts all cookies for a given URL as a JSON array of cookie objects.
     */
    fun extractCookies(url: String): String {
        val rawCookies = cookieManager.getCookie(url) ?: return "[]"
        val array = JsonArray()

        rawCookies.split(";").forEach { part ->
            val trimmed = part.trim()
            val eqIdx = trimmed.indexOf('=')
            if (eqIdx > 0) {
                val name = trimmed.substring(0, eqIdx).trim()
                val value = trimmed.substring(eqIdx + 1).trim()
                val obj = JsonObject()
                obj.addProperty("name", name)
                obj.addProperty("value", value)
                try {
                    obj.addProperty("domain", Uri.parse(url).host ?: "")
                } catch (_: Exception) {}
                obj.addProperty("path", "/")
                array.add(obj)
            }
        }

        return gson.toJson(array)
    }

    /**
     * Clears cookies for a domain or removes all session cookies.
     */
    fun clearCookies(domain: String? = null) {
        if (domain == null) {
            cookieManager.removeAllCookies(null)
        } else {
            val url = if (domain.startsWith("http")) domain else "https://$domain"
            val cookies = cookieManager.getCookie(url) ?: return
            cookies.split(";").forEach { part ->
                val eqIdx = part.indexOf('=')
                if (eqIdx > 0) {
                    val name = part.substring(0, eqIdx).trim()
                    cookieManager.setCookie(url, "$name=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/")
                }
            }
        }
        cookieManager.flush()
    }
}
