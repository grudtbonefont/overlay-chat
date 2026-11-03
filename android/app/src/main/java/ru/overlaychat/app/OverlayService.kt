package ru.overlaychat.app

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.NotificationCompat
import ru.overlaychat.app.databinding.OverlayChatBinding
import kotlin.concurrent.thread

class OverlayService : Service() {
    companion object {
        const val CHANNEL_ID = "overlay_chat_channel"
        private const val NOTIF_ID = 42
    }

    private lateinit var wm: WindowManager
    private lateinit var binding: OverlayChatBinding
    private lateinit var params: WindowManager.LayoutParams
    private var locked = false
    private var minimized = false

    private var tab = "chats" // chats|friends|rooms
    private var current: ChatTarget? = null
    private val messages = mutableListOf<ApiClient.Message>()

    private data class ChatTarget(val type: String, val id: Int, val title: String)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startForeground(NOTIF_ID, buildNotification())
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        binding = OverlayChatBinding.inflate(LayoutInflater.from(this))

        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE

        params = WindowManager.LayoutParams(
            dp(320),
            dp(420),
            type,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = dp(24)
            y = dp(80)
            softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
        }

        setupUi()
        wm.addView(binding.root, params)

        SocketManager.onMessage = { msg ->
            if (matchesCurrent(msg)) {
                messages.add(msg)
                renderMessages()
            }
        }
        if (!SocketManager.connected && Prefs.token != null) {
            SocketManager.connect()
        }
        showListTab()
    }

    private fun setupUi() {
        enableDrag(binding.titleBar)
        enableDrag(binding.lockHandle)

        binding.btnLock.setOnClickListener { setLocked(!locked) }
        binding.lockHandle.setOnClickListener {
            if (locked) setLocked(false)
            else if (minimized) expandFromBubble()
        }
        binding.btnMinimize.setOnClickListener { minimizeToBubble() }
        binding.btnCloseOverlay.setOnClickListener { stopSelf() }

        binding.tabChats.setOnClickListener { tab = "chats"; showListTab() }
        binding.tabFriends.setOnClickListener { tab = "friends"; showListTab() }
        binding.tabRooms.setOnClickListener { tab = "rooms"; showListTab() }

        binding.btnSend.setOnClickListener { sendMessage() }
        binding.overlayInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEND) {
                sendMessage(); true
            } else false
        }
        // Tap input → focus + IME
        binding.overlayInput.setOnClickListener {
            binding.overlayInput.requestFocus()
            showKeyboard(true)
        }
    }

    private fun setLocked(value: Boolean) {
        locked = value
        if (locked) {
            // FLAG_NOT_TOUCHABLE — касания уходят в игру; отдельное маленькое окно-ручка остаётся touchable
            params.flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
            binding.btnLock.text = "🔒"
            binding.chatPanel.alpha = 0.55f
            // Показать отдельную touchable ручку поверх — через второй слой: снимаем NOT_TOUCHABLE с root
            // и делаем chatPanel некликабельным, а lockHandle — кликабельным.
            // Надёжнее: убрать NOT_TOUCHABLE у root и фильтровать касания.
            params.flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
            binding.chatPanel.isClickable = false
            binding.chatPanel.isEnabled = false
            setTouchableRecursive(binding.chatPanel, false)
            binding.lockHandle.visibility = View.VISIBLE
            binding.lockHandle.isClickable = true
            binding.lockHandle.isEnabled = true
            binding.lockHandle.bringToFront()
            // Для прохождения касаний в игру за пределами ручки — используем filterTouchesWhenObscured нет;
            // ставим root listener: вне ручки — не потребляем (но View всё равно получает).
            // Правильный путь: FLAG_NOT_TOUCHABLE на всём + отдельный Window для ручки.
            ensureHandleWindow()
        } else {
            removeHandleWindow()
            params.flags = WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH
            binding.btnLock.text = "🔓"
            binding.chatPanel.alpha = 0.92f
            binding.chatPanel.isClickable = true
            binding.chatPanel.isEnabled = true
            setTouchableRecursive(binding.chatPanel, true)
            binding.lockHandle.visibility = View.GONE
            if (minimized) expandFromBubble()
        }
        try { wm.updateViewLayout(binding.root, params) } catch (_: Exception) {}
    }

    private var handleView: View? = null
    private var handleParams: WindowManager.LayoutParams? = null

    private fun ensureHandleWindow() {
        if (handleView != null) return
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
        val tv = TextView(this).apply {
            text = "🔒"
            textSize = 20f
            gravity = Gravity.CENTER
            setBackgroundResource(R.drawable.bg_handle)
            setOnClickListener { setLocked(false) }
            setOnTouchListener(dragListenerForHandle())
        }
        val hp = WindowManager.LayoutParams(
            dp(48), dp(48), type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = params.x
            y = params.y
        }
        // Основное окно — полностью NOT_TOUCHABLE
        params.flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
        try { wm.updateViewLayout(binding.root, params) } catch (_: Exception) {}
        wm.addView(tv, hp)
        handleView = tv
        handleParams = hp
        binding.lockHandle.visibility = View.GONE
    }

    private fun removeHandleWindow() {
        handleView?.let {
            try { wm.removeView(it) } catch (_: Exception) {}
        }
        handleView = null
        handleParams = null
    }

    private fun dragListenerForHandle(): View.OnTouchListener {
        var ox = 0; var oy = 0; var px = 0; var py = 0; var moved = false
        return View.OnTouchListener { _, e ->
            val hp = handleParams ?: return@OnTouchListener false
            when (e.action) {
                MotionEvent.ACTION_DOWN -> {
                    ox = hp.x; oy = hp.y; px = e.rawX.toInt(); py = e.rawY.toInt(); moved = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX.toInt() - px; val dy = e.rawY.toInt() - py
                    if (kotlin.math.abs(dx) + kotlin.math.abs(dy) > 8) moved = true
                    hp.x = ox + dx; hp.y = oy + dy
                    params.x = hp.x; params.y = hp.y
                    try {
                        wm.updateViewLayout(handleView, hp)
                        wm.updateViewLayout(binding.root, params)
                    } catch (_: Exception) {}
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (!moved) handleView?.performClick()
                    true
                }
                else -> false
            }
        }
    }

    private fun setTouchableRecursive(v: View, enabled: Boolean) {
        v.isEnabled = enabled
        v.isClickable = enabled
        if (v is android.view.ViewGroup) {
            for (i in 0 until v.childCount) setTouchableRecursive(v.getChildAt(i), enabled)
        }
    }

    private fun minimizeToBubble() {
        minimized = true
        binding.chatPanel.visibility = View.GONE
        binding.lockHandle.visibility = View.VISIBLE
        binding.lockHandle.text = "💬"
        params.width = dp(48)
        params.height = dp(48)
        try { wm.updateViewLayout(binding.root, params) } catch (_: Exception) {}
    }

    private fun expandFromBubble() {
        minimized = false
        binding.chatPanel.visibility = View.VISIBLE
        binding.lockHandle.visibility = View.GONE
        params.width = dp(320)
        params.height = dp(420)
        try { wm.updateViewLayout(binding.root, params) } catch (_: Exception) {}
    }

    private fun enableDrag(handle: View) {
        var ox = 0; var oy = 0; var px = 0; var py = 0
        handle.setOnTouchListener { _, e ->
            if (locked) return@setOnTouchListener false
            when (e.action) {
                MotionEvent.ACTION_DOWN -> {
                    ox = params.x; oy = params.y
                    px = e.rawX.toInt(); py = e.rawY.toInt()
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    params.x = ox + (e.rawX.toInt() - px)
                    params.y = oy + (e.rawY.toInt() - py)
                    try { wm.updateViewLayout(binding.root, params) } catch (_: Exception) {}
                    true
                }
                else -> false
            }
        }
    }

    private fun showListTab() {
        current = null
        binding.listScroll.visibility = View.VISIBLE
        binding.messagesScroll.visibility = View.GONE
        binding.inputRow.visibility = View.GONE
        binding.overlayTitle.text = "Overlay Chat"
        colorTabs()
        binding.listContainer.removeAllViews()
        thread {
            try {
                when (tab) {
                    "friends" -> {
                        val (friends, incoming, _) = ApiClient.friends()
                        runOnMain {
                            incoming.forEach { fr ->
                                addRow("← ${fr.nickname} (принять)") {
                                    thread {
                                        try {
                                            ApiClient.friendRespond(fr.requestId, true)
                                            runOnMain { showListTab() }
                                        } catch (e: Exception) {
                                            toast(e.message)
                                        }
                                    }
                                }
                            }
                            friends.forEach { f ->
                                addRow("${if (f.online) "●" else "○"} ${f.nickname}") {
                                    openChat(ChatTarget("dm", f.id, f.nickname))
                                }
                            }
                            if (friends.isEmpty() && incoming.isEmpty()) addRow("Нет друзей", null)
                        }
                    }
                    "rooms" -> {
                        val rooms = ApiClient.rooms()
                        runOnMain {
                            rooms.forEach { r ->
                                addRow("${r.name} [${r.code}]") {
                                    SocketManager.joinRoomSocket(r.id)
                                    openChat(ChatTarget("room", r.id, r.name))
                                }
                            }
                            if (rooms.isEmpty()) addRow("Нет комнат", null)
                        }
                    }
                    else -> {
                        val (friends, _, _) = ApiClient.friends()
                        val rooms = ApiClient.rooms()
                        runOnMain {
                            friends.forEach { f ->
                                addRow("ЛС: ${f.nickname}") {
                                    openChat(ChatTarget("dm", f.id, f.nickname))
                                }
                            }
                            rooms.forEach { r ->
                                addRow("Комната: ${r.name}") {
                                    SocketManager.joinRoomSocket(r.id)
                                    openChat(ChatTarget("room", r.id, r.name))
                                }
                            }
                            if (friends.isEmpty() && rooms.isEmpty()) addRow("Пусто — добавьте друзей/комнаты в приложении", null)
                        }
                    }
                }
            } catch (e: Exception) {
                runOnMain { addRow("Ошибка: ${e.message}", null) }
            }
        }
    }

    private fun openChat(target: ChatTarget) {
        current = target
        binding.listScroll.visibility = View.GONE
        binding.messagesScroll.visibility = View.VISIBLE
        binding.inputRow.visibility = View.VISIBLE
        binding.overlayTitle.text = target.title
        messages.clear()
        binding.messagesView.text = "Загрузка…"
        thread {
            try {
                val list = if (target.type == "room") ApiClient.roomMessages(target.id)
                else ApiClient.dmMessages(target.id)
                runOnMain {
                    messages.clear()
                    messages.addAll(list)
                    renderMessages()
                }
            } catch (e: Exception) {
                runOnMain { binding.messagesView.text = e.message }
            }
        }
    }

    private fun renderMessages() {
        val me = Prefs.userId
        val text = messages.joinToString("\n") { m ->
            val who = if (m.senderId == me) "Вы" else m.senderNickname
            "$who: ${m.content}"
        }
        binding.messagesView.text = text.ifBlank { "Нет сообщений" }
        binding.messagesScroll.post { binding.messagesScroll.fullScroll(View.FOCUS_DOWN) }
    }

    private fun matchesCurrent(msg: ApiClient.Message): Boolean {
        val c = current ?: return false
        return if (c.type == "room") msg.roomId == c.id
        else {
            val me = Prefs.userId
            (msg.senderId == c.id && msg.recipientId == me) ||
                (msg.senderId == me && msg.recipientId == c.id)
        }
    }

    private fun sendMessage() {
        val c = current ?: return
        val text = binding.overlayInput.text?.toString()?.trim().orEmpty()
        if (text.isEmpty()) return
        val cb: (Boolean, String?) -> Unit = { ok, err ->
            if (ok) {
                binding.overlayInput.setText("")
                showKeyboard(false)
                binding.overlayInput.clearFocus()
            } else toast(err)
        }
        if (c.type == "room") SocketManager.sendRoom(c.id, text, cb)
        else SocketManager.sendDm(c.id, text, cb)
    }

    private fun addRow(label: String, click: (() -> Unit)?) {
        val tv = TextView(this).apply {
            this.text = label
            setTextColor(0xFFF0F2F5.toInt())
            textSize = 13f
            setPadding(dp(8), dp(10), dp(8), dp(10))
            if (click != null) setOnClickListener { click() }
        }
        binding.listContainer.addView(
            tv,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        )
    }

    private fun colorTabs() {
        binding.tabChats.setTextColor(if (tab == "chats") 0xFF2F6FED.toInt() else 0xFF9AA3B2.toInt())
        binding.tabFriends.setTextColor(if (tab == "friends") 0xFF2F6FED.toInt() else 0xFF9AA3B2.toInt())
        binding.tabRooms.setTextColor(if (tab == "rooms") 0xFF2F6FED.toInt() else 0xFF9AA3B2.toInt())
    }

    private fun showKeyboard(show: Boolean) {
        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        if (show) imm.showSoftInput(binding.overlayInput, InputMethodManager.SHOW_IMPLICIT)
        else imm.hideSoftInputFromWindow(binding.overlayInput.windowToken, 0)
    }

    private fun buildNotification(): Notification {
        val pi = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.overlay_notification_title))
            .setContentText(getString(R.string.overlay_notification_text))
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pi)
            .setOngoing(true)
            .build()
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
    private fun runOnMain(block: () -> Unit) = android.os.Handler(mainLooper).post(block)
    private fun toast(msg: String?) = runOnMain {
        Toast.makeText(this, msg ?: "Ошибка", Toast.LENGTH_SHORT).show()
    }

    override fun onDestroy() {
        removeHandleWindow()
        try { wm.removeView(binding.root) } catch (_: Exception) {}
        SocketManager.onMessage = null
        super.onDestroy()
    }
}
