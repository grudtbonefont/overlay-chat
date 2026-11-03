package ru.overlaychat.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build

class OverlayChatApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Prefs.init(this)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                OverlayService.CHANNEL_ID,
                getString(R.string.overlay_notification_channel),
                NotificationManager.IMPORTANCE_LOW
            )
            ch.description = "Фоновый оверлей-чат поверх игр"
            getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
        }
    }
}
