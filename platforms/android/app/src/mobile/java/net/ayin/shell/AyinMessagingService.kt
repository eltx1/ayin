package net.ayin.shell

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject
import java.util.UUID

internal object MobilePushState {
    const val CHANNEL = "ayin_updates"
    var listener: ((JSONObject) -> Unit)? = null
    fun prefs(context: Context) = context.getSharedPreferences("ayin_mobile_private", Context.MODE_PRIVATE)
    fun installationId(context: Context): String {
        val p = prefs(context)
        return p.getString("installation_id", null) ?: UUID.randomUUID().toString().also { p.edit().putString("installation_id", it).commit() }
    }
    fun allowed(context: Context): Boolean = prefs(context).getBoolean("push_enabled", false) &&
        !prefs(context).getString("account_id", null).isNullOrEmpty() &&
        NotificationManagerCompat.from(context).areNotificationsEnabled() &&
        (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
    fun channel(context: Context) {
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "AYIN updates", NotificationManager.IMPORTANCE_DEFAULT))
    }
    fun emit(event: JSONObject) { Handler(Looper.getMainLooper()).post { listener?.invoke(event) } }
}

class AyinMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        if (MobilePushState.allowed(this)) MobilePushState.emit(JSONObject().put("type", "notification.token").put("token", token).put("recipientAccountId", MobilePushState.prefs(this).getString("account_id", "")))
        // The authenticated web layer reads the current token again on every foreground/login.
        // Never log tokens or attach a token to an account from this background service.
    }

    override fun onMessageReceived(message: RemoteMessage) {
        if (!MobilePushState.allowed(this)) return
        val data = message.data
        val account = MobilePushState.prefs(this).getString("account_id", "")
        if (data["recipientAccountId"] != account) return
        val id = data["notificationId"]?.takeIf { runCatching { UUID.fromString(it) }.isSuccess } ?: return
        val type = data["type"]?.takeIf { it in setOf("system", "channel", "video", "comment", "subscription", "moderation", "monetization") } ?: return
        val p = MobilePushState.prefs(this)
        if (!p.getBoolean("push_type_$type", true)) return
        val recent = p.getString("received_ids", "").orEmpty().split(',').filter(String::isNotEmpty)
        if (id in recent) return
        p.edit().putString("received_ids", (recent.takeLast(63) + id).joinToString(",")).commit()
        // Route resolution is authenticated on the web. Deleted/private destinations remain protected.
        val target = "${BuildConfig.AYIN_ORIGIN}/notifications"
        val event = JSONObject().put("type", "notification.received").put("notificationId", id).put("route", "/notifications").put("recipientAccountId", account)
        MobilePushState.emit(event)
        MobilePushState.channel(this)
        val intent = Intent(this, MainActivity::class.java).apply {
            data = android.net.Uri.parse(target)
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("ayin_notification_id", id)
            putExtra("ayin_recipient_id", account)
        }
        val pending = PendingIntent.getActivity(this, id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, MobilePushState.CHANNEL)
            .setSmallIcon(R.drawable.ayin_notification_icon)
            .setContentTitle(data["title"]?.take(120) ?: "AYIN")
            .setContentText(data["body"]?.take(240) ?: "You have a new notification")
            .setAutoCancel(true).setContentIntent(pending).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .build()
        if (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            NotificationManagerCompat.from(this).notify(id.hashCode(), notification)
        }
    }
}
