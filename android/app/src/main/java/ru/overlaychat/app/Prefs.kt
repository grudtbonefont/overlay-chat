package ru.overlaychat.app

import android.content.Context
import android.content.SharedPreferences

object Prefs {
    private lateinit var p: SharedPreferences

    fun init(ctx: Context) {
        p = ctx.applicationContext.getSharedPreferences("overlay_chat", Context.MODE_PRIVATE)
    }

    var serverUrl: String
        get() = p.getString("serverUrl", "https://overlay-chat-server-4wmq.onrender.com") ?: "https://overlay-chat-server-4wmq.onrender.com"
        set(v) = p.edit().putString("serverUrl", v.trim().trimEnd('/')).apply()

    var token: String?
        get() = p.getString("token", null)
        set(v) = p.edit().putString("token", v).apply()

    var nickname: String?
        get() = p.getString("nickname", null)
        set(v) = p.edit().putString("nickname", v).apply()

    var userId: Int
        get() = p.getInt("userId", -1)
        set(v) = p.edit().putInt("userId", v).apply()

    fun clearSession() {
        p.edit().remove("token").remove("nickname").remove("userId").apply()
    }
}
