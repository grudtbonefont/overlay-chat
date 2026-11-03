package ru.overlaychat.app

import android.os.Handler
import android.os.Looper
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONObject
import java.net.URI

object SocketManager {
    private var socket: Socket? = null
    private val main = Handler(Looper.getMainLooper())

    @Volatile var connected: Boolean = false
        private set

    var onMessage: ((ApiClient.Message) -> Unit)? = null
    var onPresence: ((userId: Int, online: Boolean) -> Unit)? = null
    var onFriendRequest: ((fromId: Int, nick: String) -> Unit)? = null
    var onStatus: ((String) -> Unit)? = null

    fun connect() {
        disconnect()
        val token = Prefs.token ?: return
        val opts = IO.Options().apply {
            forceNew = true
            reconnection = true
            auth = mapOf("token" to token)
            transports = arrayOf("websocket", "polling")
            timeout = 12000
        }
        val s = IO.socket(URI.create(Prefs.serverUrl), opts)
        socket = s
        s.on(Socket.EVENT_CONNECT) {
            connected = true
            postStatus("В сети")
        }
        s.on(Socket.EVENT_DISCONNECT) {
            connected = false
            postStatus("Отключено")
        }
        s.on(Socket.EVENT_CONNECT_ERROR) { args ->
            connected = false
            val msg = args.firstOrNull()?.toString() ?: "ошибка"
            postStatus("Ошибка: $msg")
        }
        s.on("message:new") { args ->
            val o = args.firstOrNull() as? JSONObject ?: return@on
            val msg = ApiClient.Message(
                id = o.optInt("id"),
                content = o.optString("content"),
                createdAt = o.optString("created_at"),
                senderId = o.optInt("sender_id"),
                senderNickname = o.optString("sender_nickname"),
                roomId = if (o.has("room_id") && !o.isNull("room_id")) o.optInt("room_id") else null,
                recipientId = if (o.has("recipient_id") && !o.isNull("recipient_id")) o.optInt("recipient_id") else null
            )
            main.post { onMessage?.invoke(msg) }
        }
        s.on("friend:presence") { args ->
            val o = args.firstOrNull() as? JSONObject ?: return@on
            main.post { onPresence?.invoke(o.optInt("userId"), o.optBoolean("online")) }
        }
        s.on("friend:request") { args ->
            val o = args.firstOrNull() as? JSONObject ?: return@on
            val from = o.optJSONObject("from") ?: return@on
            main.post { onFriendRequest?.invoke(from.optInt("id"), from.optString("nickname")) }
        }
        s.connect()
    }

    fun disconnect() {
        socket?.off()
        socket?.disconnect()
        socket = null
        connected = false
    }

    fun joinRoomSocket(roomId: Int) {
        socket?.emit("room:join-socket", JSONObject().put("roomId", roomId))
    }

    fun sendRoom(roomId: Int, content: String, cb: (Boolean, String?) -> Unit) {
        val s = socket
        if (s == null || !connected) {
            cb(false, "Нет соединения")
            return
        }
        s.emit("message:room", JSONObject().put("roomId", roomId).put("content", content),
            io.socket.client.Ack { args ->
                val o = args.firstOrNull() as? JSONObject
                main.post {
                    if (o?.optBoolean("ok") == true) cb(true, null)
                    else cb(false, o?.optString("error") ?: "Ошибка")
                }
            })
    }

    fun sendDm(recipientId: Int, content: String, cb: (Boolean, String?) -> Unit) {
        val s = socket
        if (s == null || !connected) {
            cb(false, "Нет соединения")
            return
        }
        s.emit("message:dm", JSONObject().put("recipientId", recipientId).put("content", content),
            io.socket.client.Ack { args ->
                val o = args.firstOrNull() as? JSONObject
                main.post {
                    if (o?.optBoolean("ok") == true) cb(true, null)
                    else cb(false, o?.optString("error") ?: "Ошибка")
                }
            })
    }

    private fun postStatus(t: String) {
        main.post { onStatus?.invoke(t) }
    }
}
