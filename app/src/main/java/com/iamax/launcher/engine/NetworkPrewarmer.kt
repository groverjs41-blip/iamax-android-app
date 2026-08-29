package com.iamax.launcher.engine

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.InetAddress
import java.util.concurrent.TimeUnit

object NetworkPrewarmer {

    private val prewarmDomains = listOf(
        "chatgpt.com",
        "oaistatic.com",
        "oaiusercontent.com",
        "gemini.google.com",
        "grok.com",
        "assets.grok.com",
        "accounts.google.com",
        "notebooklm.google.com",
        "iamaxbotcrm.online"
    )

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .build()

    /**
     * Pre-resolves DNS and establishes TLS 1.3 network sockets in the background
     * so that clicking any AI card opens instantly without DNS/SSL negotiation delay.
     */
    fun prewarmAll() {
        CoroutineScope(Dispatchers.IO).launch {
            Log.d("NetworkPrewarmer", "Starting DNS and Socket pre-warming for AI tools...")

            prewarmDomains.forEach { domain ->
                launch {
                    try {
                        // 1. Pre-resolución de DNS en paralelo
                        InetAddress.getAllByName(domain)

                        // 2. Pre-conexión de socket TLS
                        val req = Request.Builder()
                            .url("https://$domain/favicon.ico")
                            .head()
                            .build()

                        httpClient.newCall(req).execute().close()
                        Log.d("NetworkPrewarmer", "Pre-warmed $domain successfully.")
                    } catch (e: Exception) {
                        Log.d("NetworkPrewarmer", "Prewarm ping for $domain: ${e.message}")
                    }
                }
            }
        }
    }
}
