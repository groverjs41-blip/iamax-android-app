package com.iamax.launcher.storage

import android.content.Context
import android.content.SharedPreferences
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken

class SessionStorage(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("iamax_session_prefs", Context.MODE_PRIVATE)
    private val gson = Gson()

    fun getString(key: String, defaultValue: String = ""): String {
        return prefs.getString(key, defaultValue) ?: defaultValue
    }

    fun setString(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }

    fun remove(key: String) {
        prefs.edit().remove(key).apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    fun removeMultiple(keys: List<String>) {
        val editor = prefs.edit()
        keys.forEach { editor.remove(it) }
        editor.apply()
    }

    fun getAll(): Map<String, String> {
        val map = mutableMapOf<String, String>()
        prefs.all.forEach { (k, v) ->
            if (v is String) map[k] = v
        }
        return map
    }

    fun getMap(key: String): Map<String, Any> {
        val json = getString(key, "{}")
        val type = object : TypeToken<Map<String, Any>>() {}.type
        return try {
            gson.fromJson(json, type) ?: emptyMap()
        } catch (e: Exception) {
            emptyMap()
        }
    }

    fun setMap(key: String, map: Map<String, Any>) {
        setString(key, gson.toJson(map))
    }
}
