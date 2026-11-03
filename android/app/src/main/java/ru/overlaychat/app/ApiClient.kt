package ru.overlaychat.app

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object ApiClient {
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    data class User(val id: Int, val nickname: String)
    data class AuthResult(val token: String, val user: User)
    data class Friend(val id: Int, val nickname: String, val online: Boolean = false)
    data class FriendRequest(val requestId: Int, val id: Int, val nickname: String)
    data class Room(val id: Int, val name: String, val code: String, val ownerId: Int = -1)
    data class Message(
        val id: Int,
        val content: String,
        val createdAt: String,
        val senderId: Int,
        val senderNickname: String,
        val roomId: Int? = null,
        val recipientId: Int? = null
    )

    private fun base() = Prefs.serverUrl.trimEnd('/')

    private fun req(method: String, path: String, body: JSONObject? = null, auth: Boolean = false): JSONObject {
        val b = body?.toString()?.toRequestBody(jsonType)
        val rb = Request.Builder().url(base() + path)
        when (method) {
            "GET" -> rb.get()
            "POST" -> rb.post(b ?: "{}".toRequestBody(jsonType))
            else -> rb.method(method, b)
        }
        if (auth) {
            val t = Prefs.token ?: throw Exception("Нет токена")
            rb.header("Authorization", "Bearer $t")
        }
        rb.header("Content-Type", "application/json")
        client.newCall(rb.build()).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            val obj = try { JSONObject(if (text.isBlank()) "{}" else text) } catch (_: Exception) {
                JSONObject().put("error", text.ifBlank { "Пустой ответ" })
            }
            if (!resp.isSuccessful) {
                throw Exception(obj.optString("error", "Ошибка ${resp.code}"))
            }
            return obj
        }
    }

    fun health(): Boolean = try {
        req("GET", "/api/health").optBoolean("ok", false)
    } catch (_: Exception) { false }

    fun register(nick: String, pass: String): AuthResult {
        val o = req("POST", "/api/register", JSONObject().put("nickname", nick).put("password", pass))
        return parseAuth(o)
    }

    fun login(nick: String, pass: String): AuthResult {
        val o = req("POST", "/api/login", JSONObject().put("nickname", nick).put("password", pass))
        return parseAuth(o)
    }

    fun me(): User {
        val o = req("GET", "/api/me", auth = true)
        val u = o.getJSONObject("user")
        return User(u.getInt("id"), u.getString("nickname"))
    }

    fun friends(): Triple<List<Friend>, List<FriendRequest>, List<FriendRequest>> {
        val o = req("GET", "/api/friends", auth = true)
        val friends = o.getJSONArray("friends").mapObj {
            Friend(it.getInt("id"), it.getString("nickname"), it.optBoolean("online", false))
        }
        val incoming = o.getJSONArray("incoming").mapObj {
            FriendRequest(it.getInt("requestId"), it.getInt("id"), it.getString("nickname"))
        }
        val outgoing = o.getJSONArray("outgoing").mapObj {
            FriendRequest(it.getInt("requestId"), it.getInt("id"), it.getString("nickname"))
        }
        return Triple(friends, incoming, outgoing)
    }

    fun friendRequest(nick: String) {
        req("POST", "/api/friends/request", JSONObject().put("nickname", nick), auth = true)
    }

    fun friendRespond(requestId: Int, accept: Boolean) {
        req(
            "POST", "/api/friends/respond",
            JSONObject().put("requestId", requestId).put("accept", accept),
            auth = true
        )
    }

    fun rooms(): List<Room> {
        val o = req("GET", "/api/rooms", auth = true)
        return o.getJSONArray("rooms").mapObj {
            Room(it.getInt("id"), it.getString("name"), it.getString("code"), it.optInt("owner_id", -1))
        }
    }

    fun createRoom(name: String): Room {
        val o = req("POST", "/api/rooms", JSONObject().put("name", name), auth = true)
        return Room(o.getInt("id"), o.getString("name"), o.getString("code"))
    }

    fun joinRoom(code: String): Room {
        val o = req("POST", "/api/rooms/join", JSONObject().put("code", code), auth = true)
        return Room(o.getInt("id"), o.getString("name"), o.getString("code"))
    }

    fun roomMessages(roomId: Int): List<Message> {
        val o = req("GET", "/api/messages/room/$roomId", auth = true)
        return parseMessages(o.getJSONArray("messages"))
    }

    fun dmMessages(friendId: Int): List<Message> {
        val o = req("GET", "/api/messages/dm/$friendId", auth = true)
        return parseMessages(o.getJSONArray("messages"))
    }

    private fun parseAuth(o: JSONObject): AuthResult {
        val u = o.getJSONObject("user")
        return AuthResult(
            o.getString("token"),
            User(u.getInt("id"), u.getString("nickname"))
        )
    }

    private fun parseMessages(arr: JSONArray): List<Message> = arr.mapObj {
        Message(
            id = it.getInt("id"),
            content = it.getString("content"),
            createdAt = it.optString("created_at", ""),
            senderId = it.getInt("sender_id"),
            senderNickname = it.optString("sender_nickname", ""),
            roomId = if (it.has("room_id") && !it.isNull("room_id")) it.getInt("room_id") else null,
            recipientId = if (it.has("recipient_id") && !it.isNull("recipient_id")) it.getInt("recipient_id") else null
        )
    }

    private fun <T> JSONArray.mapObj(fn: (JSONObject) -> T): List<T> {
        val out = ArrayList<T>(length())
        for (i in 0 until length()) out.add(fn(getJSONObject(i)))
        return out
    }
}
