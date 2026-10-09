package ru.berisegodnya.app;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

/** HTTPS-only, same-origin API. No WebView, browser session, TLS bypass, or automatic mutation retry. */
final class ApiClient {
    static final class Failure extends Exception {
        final int status; final String code;
        Failure(int status, String code, String message) { super(message); this.status = status; this.code = code; }
    }
    private final SecureStore store;
    private volatile String session = "";
    private volatile String adminSession = "";
    private volatile String customerSession = "";
    ApiClient(SecureStore store) { this.store = store; }
    void restore() throws Exception { session = store.get("session"); adminSession = store.get("admin-session"); customerSession = store.get("customer-session"); }
    boolean hasCustomerSession() { return !customerSession.isEmpty(); }
    void forgetCustomerSession() { customerSession = ""; store.remove("customer-session"); store.remove("customer-profile"); store.remove("customer-bookings"); }
    boolean hasSession() { return !session.isEmpty(); }
    boolean hasAdminSession() { return !adminSession.isEmpty(); }
    void forgetAdminSession() { adminSession = ""; store.remove("admin-session"); }
    void forgetSession() { session = ""; store.remove("session"); store.remove("offer-draft"); store.remove("publication-uncertain"); }
    Object request(String method, String path, JSONObject body, boolean authenticated) throws Exception {
        if (!path.matches("/api/(public|partner|admin|customer)/[a-zA-Z0-9_/?=&%-]+") || path.contains("..")) throw new IllegalArgumentException("Недопустимый адрес запроса");
        boolean admin = path.startsWith("/api/admin/");
        boolean customer = path.startsWith("/api/customer/") || (path.equals("/api/public/bookings") && body != null && body.optBoolean("accountBooking"));
        HttpsURLConnection connection = (HttpsURLConnection) new URL(AppRules.ORIGIN + path).openConnection();
        try {
            connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(12000); connection.setReadTimeout(20000);
            connection.setRequestMethod(method); connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Origin", AppRules.ORIGIN); connection.setRequestProperty("X-BS-Request", "1");
            String cookieSession = customer ? customerSession : admin ? adminSession : session;
            if (authenticated && !cookieSession.isEmpty()) connection.setRequestProperty("Cookie", (customer ? "__Host-bs_customer=" : "__Host-bs_session=") + cookieSession);
            if (body != null) {
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setFixedLengthStreamingMode(bytes.length);
                try (var output = connection.getOutputStream()) { output.write(bytes); }
            }
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) throw new Failure(status, "REDIRECT", "Сервер изменил адрес. Попробуйте позже.");
            String raw;
            try (InputStream input = status < 400 ? connection.getInputStream() : connection.getErrorStream()) {
                raw = new String(readLimited(input, 2 * 1024 * 1024), StandardCharsets.UTF_8);
            }
            JSONObject envelope;
            try { envelope = new JSONObject(raw); } catch (Exception error) { throw new Failure(status, "SERVER_RESPONSE", "Сервис временно недоступен. Попробуйте позже."); }
            if (!envelope.optBoolean("ok")) {
                JSONObject error = envelope.optJSONObject("error");
                if (authenticated && status == 401) { if (customer) forgetCustomerSession(); else if (admin) forgetAdminSession(); else forgetSession(); }
                throw new Failure(status, error == null ? "SERVER_RESPONSE" : error.optString("code"), error == null ? "Не удалось выполнить действие" : error.optString("message", "Не удалось выполнить действие"));
            }
            // Accept only our named session cookie, only from authentication responses at the pinned origin.
            if (path.startsWith("/api/partner/auth/") || path.startsWith("/api/admin/auth/") || path.startsWith("/api/customer/auth/")) {
                for (Map.Entry<String, List<String>> header : connection.getHeaderFields().entrySet()) {
                    if (!"Set-Cookie".equalsIgnoreCase(header.getKey())) continue;
                    for (String cookie : header.getValue()) {
                        String value = customer ? AppRules.customerSessionCookieValue(cookie) : AppRules.sessionCookieValue(cookie);
                        if (value == null) continue;
                        if (value.isEmpty()) { if (customer) forgetCustomerSession(); else if (admin) forgetAdminSession(); else forgetSession(); }
                        else if (value.matches("[a-zA-Z0-9_-]{10,200}")) {
                            store.put(customer ? "customer-session" : admin ? "admin-session" : "session", value);
                            if (customer) customerSession = value; else if (admin) adminSession = value; else session = value;
                        }
                    }
                }
            }
            return envelope.get("data");
        } finally { connection.disconnect(); }
    }
    Bitmap image(String path) throws Exception {
        if (!AppRules.trustedImage(path)) return null;
        HttpsURLConnection connection = (HttpsURLConnection) new URL(AppRules.ORIGIN + path).openConnection();
        try {
            connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(10000); connection.setReadTimeout(15000);
            // Private draft photos require the partner's session. It is sent only to the fixed HTTPS origin, never on redirects.
            if (path.startsWith("/uploads/") && !session.isEmpty()) connection.setRequestProperty("Cookie", "__Host-bs_session=" + session);
            if (connection.getResponseCode() != 200) return null;
            byte[] bytes;
            try (InputStream input = connection.getInputStream()) { bytes = readLimited(input, 8 * 1024 * 1024); }
            BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            bounds.inJustDecodeBounds = false; bounds.inSampleSize = 1;
            while (Math.max(bounds.outWidth, bounds.outHeight) / bounds.inSampleSize > 1280) bounds.inSampleSize *= 2;
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        } finally { connection.disconnect(); }
    }
    static byte[] readLimited(InputStream input, int limit) throws Exception {
        if (input == null) return new byte[0];
        ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int count;
        while ((count = input.read(buffer)) != -1) {
            if (output.size() + count > limit) throw new IllegalArgumentException("Ответ слишком большой. Попробуйте позже.");
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }
}
