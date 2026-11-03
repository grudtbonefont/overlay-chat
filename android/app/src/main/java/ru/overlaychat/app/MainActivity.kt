package ru.overlaychat.app

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import ru.overlaychat.app.databinding.ActivityMainBinding
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {
    private lateinit var b: ActivityMainBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityMainBinding.inflate(layoutInflater)
        setContentView(b.root)

        b.inputServer.setText(Prefs.serverUrl)

        b.btnSaveServer.setOnClickListener {
            val url = b.inputServer.text.toString().trim()
            if (url.isBlank()) {
                showErr("Укажите адрес сервера")
                return@setOnClickListener
            }
            Prefs.serverUrl = url
            Toast.makeText(this, "Адрес сохранён", Toast.LENGTH_SHORT).show()
            if (Prefs.token != null) {
                SocketManager.disconnect()
                SocketManager.connect()
            }
        }

        b.btnLogin.setOnClickListener { auth(false) }
        b.btnRegister.setOnClickListener { auth(true) }
        b.btnLogout.setOnClickListener {
            stopOverlay()
            SocketManager.disconnect()
            Prefs.clearSession()
            refreshUi()
        }
        b.btnOverlay.setOnClickListener { startOverlay() }
        b.btnStopOverlay.setOnClickListener { stopOverlay() }
        b.btnAddFriend.setOnClickListener {
            val nick = b.inputFriend.text.toString().trim()
            if (nick.isEmpty()) return@setOnClickListener
            thread {
                try {
                    ApiClient.friendRequest(nick)
                    runOnUiThread {
                        Toast.makeText(this, "Заявка отправлена", Toast.LENGTH_SHORT).show()
                        refreshLists()
                    }
                } catch (e: Exception) {
                    runOnUiThread { showErr(e.message) }
                }
            }
        }
        b.btnCreateRoom.setOnClickListener {
            val name = b.inputRoom.text.toString().trim().ifBlank { "Комната" }
            thread {
                try {
                    val r = ApiClient.createRoom(name)
                    SocketManager.joinRoomSocket(r.id)
                    runOnUiThread {
                        Toast.makeText(this, "Код: ${r.code}", Toast.LENGTH_LONG).show()
                        refreshLists()
                    }
                } catch (e: Exception) {
                    runOnUiThread { showErr(e.message) }
                }
            }
        }
        b.btnJoinRoom.setOnClickListener {
            val code = b.inputRoom.text.toString().trim()
            if (code.isEmpty()) return@setOnClickListener
            thread {
                try {
                    val r = ApiClient.joinRoom(code)
                    SocketManager.joinRoomSocket(r.id)
                    runOnUiThread {
                        Toast.makeText(this, "В комнате ${r.name}", Toast.LENGTH_SHORT).show()
                        refreshLists()
                    }
                } catch (e: Exception) {
                    runOnUiThread { showErr(e.message) }
                }
            }
        }

        SocketManager.onStatus = { b.statusText.text = it }
        refreshUi()
        if (Prefs.token != null) {
            SocketManager.connect()
            refreshLists()
        }
    }

    private fun auth(register: Boolean) {
        val nick = b.inputNick.text.toString().trim()
        val pass = b.inputPass.text.toString()
        if (nick.length < 2 || pass.length < 4) {
            showErr("Ник ≥2, пароль ≥4")
            return
        }
        Prefs.serverUrl = b.inputServer.text.toString().trim().ifBlank { Prefs.serverUrl }
        thread {
            try {
                val res = if (register) ApiClient.register(nick, pass) else ApiClient.login(nick, pass)
                Prefs.token = res.token
                Prefs.nickname = res.user.nickname
                Prefs.userId = res.user.id
                SocketManager.connect()
                runOnUiThread {
                    showErr(null)
                    refreshUi()
                    refreshLists()
                    Toast.makeText(this, "Привет, ${res.user.nickname}!", Toast.LENGTH_SHORT).show()
                }
            } catch (e: Exception) {
                runOnUiThread { showErr(e.message) }
            }
        }
    }

    private fun refreshUi() {
        val logged = Prefs.token != null
        b.authPanel.visibility = if (logged) View.GONE else View.VISIBLE
        b.mainPanel.visibility = if (logged) View.VISIBLE else View.GONE
        b.statusText.text = if (logged) {
            "Вы: ${Prefs.nickname} · ${if (SocketManager.connected) "в сети" else "подключение…"}"
        } else "Не в сети"
    }

    private fun refreshLists() {
        thread {
            try {
                val (friends, incoming, outgoing) = ApiClient.friends()
                val rooms = ApiClient.rooms()
                val sb = StringBuilder()
                sb.appendLine("— Друзья —")
                friends.forEach { sb.appendLine("${if (it.online) "●" else "○"} ${it.nickname}") }
                if (incoming.isNotEmpty()) {
                    sb.appendLine("— Входящие —")
                    incoming.forEach { sb.appendLine("← ${it.nickname} (#${it.requestId})") }
                }
                if (outgoing.isNotEmpty()) {
                    sb.appendLine("— Исходящие —")
                    outgoing.forEach { sb.appendLine("→ ${it.nickname}") }
                }
                sb.appendLine("— Комнаты —")
                rooms.forEach { sb.appendLine("${it.name} [${it.code}]") }
                runOnUiThread { b.listInfo.text = sb.toString() }
            } catch (e: Exception) {
                runOnUiThread { showErr(e.message) }
            }
        }
    }

    private fun startOverlay() {
        if (!Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "Разрешите показ поверх других окон", Toast.LENGTH_LONG).show()
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName")
            )
            startActivity(intent)
            return
        }
        val i = Intent(this, OverlayService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(i)
        else startService(i)
        Toast.makeText(this, "Оверлей запущен", Toast.LENGTH_SHORT).show()
    }

    private fun stopOverlay() {
        stopService(Intent(this, OverlayService::class.java))
    }

    private fun showErr(msg: String?) {
        if (msg.isNullOrBlank()) {
            b.errorText.visibility = View.GONE
        } else {
            b.errorText.visibility = View.VISIBLE
            b.errorText.text = msg
        }
    }

    override fun onResume() {
        super.onResume()
        refreshUi()
    }
}
