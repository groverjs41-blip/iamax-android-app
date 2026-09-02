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
            (function() {
                const injectedElements = new WeakSet();

                const setNativeValue = (element, value) => {
                    if (!element) return;
                    try {
                        const prototype = Object.getPrototypeOf(element);
                        const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
                        const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
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

                const injectPasswords = () => {
                    let injected = 0;
                    const passInputs = document.querySelectorAll('input[type="password"], input[name*="pass"]:not([type="hidden"]), input[id*="pass"]:not([type="hidden"]), input[name="Passwd"], input[autocomplete="current-password"], input[autocomplete="new-password"]');
                    passInputs.forEach(i => {
                        if (i.type !== 'hidden' && !String(i.value || '') && !injectedElements.has(i)) {
                            injectedElements.add(i);
                            injected++;
                            try { i.style.setProperty('-webkit-text-security', 'disc', 'important'); } catch(e) {}
                            setTimeout(() => setNativeValue(i, '$pass'), 600);
                        }
                    });
                    return injected;
                };

                const injectTOTP = () => {
                    if (!'$totp') return 0;
                    let injected = 0;
                    const totpInputs = document.querySelectorAll('input[type="tel"], input[inputmode="numeric"], input[name*="totp" i]:not([type="hidden"]), input[id*="totp" i]:not([type="hidden"]), input[name*="pin" i]:not([type="hidden"]), input[id*="pin" i]:not([type="hidden"]), input[id*="idv" i]:not([type="hidden"]), input[autocomplete="one-time-code"], input[aria-label*="código" i], input[aria-label*="codigo" i], input[aria-label*="code" i], input[placeholder*="código" i], input[placeholder*="codigo" i]');
                    totpInputs.forEach(i => {
                        if (i.type !== 'hidden' && !String(i.value || '') && !injectedElements.has(i)) {
                            injectedElements.add(i);
                            injected++;
                            try { i.style.setProperty('-webkit-text-security', 'disc', 'important'); } catch(e) {}
                            setTimeout(() => setNativeValue(i, '$totp'), 700);
                        }
                    });
                    return injected;
                };

                const injectEmail = () => {
                    let injected = 0;
                    const emailInputs = document.querySelectorAll('input[type="email"], input[name*="user"]:not([type="hidden"]), input[name*="email"]:not([type="hidden"]), input[id*="user"]:not([type="hidden"]), input[id*="email"]:not([type="hidden"]), input[name="identifier"], input[id="identifierId"], input[autocomplete="username"], input[autocomplete="email"]');
                    emailInputs.forEach(i => {
                        if (i.type !== 'hidden' && !String(i.value || '') && !injectedElements.has(i)) {
                            injectedElements.add(i);
                            injected++;
                            try { i.style.setProperty('-webkit-text-security', 'disc', 'important'); } catch(e) {}
                            setTimeout(() => setNativeValue(i, '$email'), 400);
                        }
                    });

                    if (injected === 0) {
                        const textInputs = document.querySelectorAll('input[type="text"], input:not([type])');
                        textInputs.forEach(i => {
                            const rect = i.getBoundingClientRect();
                            if (rect.width > 0 && rect.height > 0 && !String(i.value || '').trim() && !injectedElements.has(i)) {
                                injectedElements.add(i);
                                injected++;
                                try { i.style.setProperty('-webkit-text-security', 'disc', 'important'); } catch(e) {}
                                setTimeout(() => setNativeValue(i, '$email'), 400);
                            }
                        });
                    }

                    return injected;
                };

                let injectedEmail = injectEmail();
                let injectedPass = injectPasswords();
                let injectedTotp = injectTOTP();

                let observer = null;
                if (injectedEmail === 0 || injectedPass === 0 || ('$totp' && injectedTotp === 0)) {
                    observer = new MutationObserver(() => {
                        const e = injectEmail();
                        const p = injectPasswords();
                        const t = injectTOTP();
                        if (p > 0 || t > 0 || e > 0) {
                            setTimeout(() => {
                                if (observer) {
                                    observer.disconnect();
                                    observer = null;
                                }
                            }, 1000);
                        }
                    });
                    const targetNode = document.body || document.documentElement;
                    if (targetNode) {
                        observer.observe(targetNode, { childList: true, subtree: true });
                    }
                    setTimeout(() => {
                        if (observer) {
                            observer.disconnect();
                            observer = null;
                        }
                    }, 30000);
                }
            })();
        """.trimIndent()
    }
}
