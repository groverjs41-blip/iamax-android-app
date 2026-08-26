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
     * Supports both array of cookie objects and raw cookie strings.
     */
    fun injectCookies(cookiesJson: String, targetUrl: String? = null): Boolean {
        if (cookiesJson.isBlank()) return false

        try {
            val jsonElement = gson.fromJson(cookiesJson, JsonElement::class.java)

            if (jsonElement.isJsonArray) {
                val array = jsonElement.asJsonArray
                for (item in array) {
                    if (item.isJsonObject) {
                        injectCookieObject(item.asJsonObject, targetUrl)
                    } else if (item.isJsonPrimitive && item.asJsonPrimitive.isString) {
                        injectRawCookie(item.asString, targetUrl)
                    }
                }
            } else if (jsonElement.isJsonObject) {
                injectCookieObject(jsonElement.asJsonObject, targetUrl)
            } else if (jsonElement.isJsonPrimitive && jsonElement.asJsonPrimitive.isString) {
                injectRawCookie(jsonElement.asString, targetUrl)
            }

            cookieManager.flush()
            Log.d("CookieInjector", "Cookies injected successfully for $targetUrl")
            return true
        } catch (e: Exception) {
            Log.e("CookieInjector", "Error injecting cookies: ${e.message}", e)
            return false
        }
    }

    private fun injectCookieObject(cookie: JsonObject, fallbackUrl: String?) {
        val name = cookie.get("name")?.asString ?: return
        val value = cookie.get("value")?.asString ?: ""
        var domain = cookie.get("domain")?.asString ?: ""
        val path = cookie.get("path")?.asString ?: "/"
        val secure = cookie.get("secure")?.asBoolean ?: true
        val httpOnly = cookie.get("httpOnly")?.asBoolean ?: false
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
        if (!sameSite.isNullOrBlank() && !sameSite.equals("no_restriction", ignoreCase = true)) {
            sb.append("; SameSite=$sameSite")
        }

        cookieManager.setCookie(targetUrl, sb.toString())
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
