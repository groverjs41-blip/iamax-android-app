package com.iamax.launcher.engine

import android.content.Context
import android.util.Log
import android.webkit.WebView
import android.widget.Toast
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.iamax.launcher.storage.SessionStorage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

class CredentialInjectorService(
    private val context: Context,
    private val sessionStorage: SessionStorage
) {
    private val httpClient = OkHttpClient()
    private val gson = Gson()

    /**
     * Obtains the specific card's bot credentials (login_email, login_password, totp)
     * from https://iamaxbotcrm.online/api/public/2fa and injects them using the extension's deep injector.
     */
    fun injectCredentials(webView: WebView) {
        val cardId = sessionStorage.getString("activeCardId", "")
        val ownerToken = sessionStorage.getString("ownerToken", "")
        val guestPassword = sessionStorage.getString("guestPassword", "")

        if (cardId.isBlank()) {
            Toast.makeText(context, "No hay perfil activo seleccionado", Toast.LENGTH_SHORT).show()
            return
        }

        Toast.makeText(context, "🔑 Obteniendo credenciales del perfil...", Toast.LENGTH_SHORT).show()

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val url = "https://iamaxbotcrm.online/api/public/2fa?cardId=$cardId"
                val reqBuilder = Request.Builder().url(url)
                if (ownerToken.isNotBlank()) {
                    reqBuilder.header("Authorization", "Bearer $ownerToken")
                }
                if (guestPassword.isNotBlank()) {
                    reqBuilder.header("X-Guest-Password", guestPassword)
                }

                val response = httpClient.newCall(reqBuilder.build()).execute()
                val body = response.body?.string() ?: ""
                val data = try { gson.fromJson(body, JsonObject::class.java) } catch (_: Exception) { null }

                if (!response.isSuccessful || data == null || !data.has("success") || !data.get("success").asBoolean || !data.has("codes")) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(context, "No se encontraron credenciales de acceso para este perfil", Toast.LENGTH_SHORT).show()
                    }
                    return@launch
                }

                val codesArray = data.getAsJsonArray("codes")
                var targetCard: JsonObject? = null
                for (elem in codesArray) {
                    if (elem.isJsonObject) {
                        val obj = elem.asJsonObject
                        val idStr = obj.get("id")?.asString ?: ""
                        if (idStr == cardId) {
                            targetCard = obj
                            break
                        }
                    }
                }

                if (targetCard == null && codesArray.size() > 0) {
                    targetCard = codesArray[0].asJsonObject
                }

                if (targetCard == null) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(context, "Credenciales no encontradas para este perfil", Toast.LENGTH_SHORT).show()
                    }
                    return@launch
                }

                val email = targetCard.get("login_email")?.asString ?: ""
                val password = targetCard.get("login_password")?.asString ?: ""
                val rawCode = targetCard.get("code")?.asString ?: ""
                val totp = if (rawCode == "------") "" else rawCode.replace("\\s+".toRegex(), "")

                if (email.isBlank() && password.isBlank()) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(context, "Este perfil no requiere credenciales de texto", Toast.LENGTH_SHORT).show()
                    }
                    return@launch
                }

                withContext(Dispatchers.Main) {
                    val safeEmail = email.replace("'", "\\'")
                    val safePass = password.replace("'", "\\'")
                    val safeTotp = totp.replace("'", "\\'")

                    val js = """
                        (function() {
                            if (typeof window.runIamaxInjection === 'function') {
                                window.runIamaxInjection('$safeEmail', '$safePass', '$safeTotp');
                            } else {
                                ${getAutoInjectorScript(safeEmail, safePass, safeTotp)}
                            }
                        })();
                    """.trimIndent()

                    webView.evaluateJavascript(js, null)
                    Toast.makeText(context, "✅ Credenciales del perfil inyectadas", Toast.LENGTH_SHORT).show()
                }

            } catch (e: Exception) {
                Log.e("CredentialInjector", "Error fetching credentials: ${e.message}", e)
                withContext(Dispatchers.Main) {
                    Toast.makeText(context, "Error al inyectar: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun getAutoInjectorScript(email: String, pass: String, totp: String): String {
        return """
            function querySelectorAllDeep(selector, root = document) {
                let results = Array.from(root.querySelectorAll(selector));
                const allElements = root.querySelectorAll('*');
                for (const el of allElements) {
                    if (el.shadowRoot) {
                        results = results.concat(querySelectorAllDeep(selector, el.shadowRoot));
                    }
                }
                return results;
            }

            const setNativeValue = (element, value) => {
                if (!element || element.value === value) return;
                try {
                    const prototype = Object.getPrototypeOf(element);
                    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
                    let valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
                    element.focus();
                    if (valueSetter && prototypeValueSetter && valueSetter !== prototypeValueSetter) {
                        prototypeValueSetter.call(element, value);
                    } else if (valueSetter) {
                        valueSetter.call(element, value);
                    } else {
                        element.value = value;
                    }
                    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                    element.blur();
                } catch(e) {
                    element.value = value;
                    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                }
            };

            const injectAll = () => {
                const emailInputs = querySelectorAllDeep('input[type="email"], input[name="email" i], input[name="username" i], input[name="identifier" i], input[id="email" i], input[id="username" i], input[id="identifierId"], input[autocomplete="username"], input[autocomplete="email"]');
                emailInputs.forEach(i => {
                    const visible = !!(i.offsetWidth || i.offsetHeight || i.getClientRects().length);
                    if (visible && i.type !== 'hidden' && !i.value) {
                        try { i.type = 'password'; } catch(e) {}
                        setNativeValue(i, '$email');
                    }
                });

                const passInputs = querySelectorAllDeep('input[type="password"], input[name="password" i], input[name="passwd" i], input[id="password" i], input[id="passwd" i], input[autocomplete="current-password"], input[autocomplete="new-password"]');
                passInputs.forEach(i => {
                    const visible = !!(i.offsetWidth || i.offsetHeight || i.getClientRects().length);
                    if (visible && i.type !== 'hidden' && !i.value) {
                        setNativeValue(i, '$pass');
                    }
                });

                if ('$totp') {
                    const totpInputs = querySelectorAllDeep('input[type="tel"], input[inputmode="numeric"], input[name*="totp" i]:not([type="hidden"]), input[id*="totp" i]:not([type="hidden"]), input[name*="otp" i]:not([type="hidden"]), input[id*="otp" i]:not([type="hidden"]), input[name*="pin" i]:not([type="hidden"]), input[id*="pin" i]:not([type="hidden"]), input[id*="idv" i]:not([type="hidden"]), input[autocomplete="one-time-code"], input[aria-label*="código" i], input[aria-label*="codigo" i], input[aria-label*="code" i], input[placeholder*="código" i], input[placeholder*="codigo" i]');
                    totpInputs.forEach(i => {
                        if (i.type !== 'hidden' && i.value !== '$totp') {
                            setNativeValue(i, '$totp');
                            try {
                                i.style.setProperty('-webkit-text-security', 'disc', 'important');
                                i.style.setProperty('filter', 'blur(7px)', 'important');
                            } catch(e) {}
                        }
                    });
                }
            };

            injectAll();
            let attempts = 0;
            const interval = setInterval(() => {
                attempts++;
                injectAll();
                if (attempts >= 8) clearInterval(interval);
            }, 1000);
        """.trimIndent()
    }
}
