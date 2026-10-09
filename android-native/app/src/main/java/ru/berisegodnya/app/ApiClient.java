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
    private String session = "";
    ApiClient(SecureStore store) { this.store = store; }
    void restore() throws Exception { session = store.get("session"); }
    boolean hasSession() { return !session.isEmpty(); }
    void forgetSession() { session = ""; store.remove("session"); store.remove("offer-draft"); }
    Object request(String method, String path, JSONObject body, boolean authenticated) throws Exception {
        if (!path.matches("/api/(public|partner)/[a-zA-Z0-9_/?=&%-]+") || path.contains("..")) throw new IllegalArgumentException("Недопустимый адрес запроса");
        HttpsURLConnection connection = (HttpsURLConnection) new URL(AppRules.ORIGIN + path).openConnection();
        try {
            connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(12000); connection.setReadTimeout(20000);
            connection.setRequestMethod(method); connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Origin", AppRules.ORIGIN); connection.setRequestProperty("X-BS-Request", "1");
            if (authenticated && !session.isEmpty()) connection.setRequestProperty("Cookie", "bs_session=" + session);
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
                if (authenticated && status == 401) forgetSession();
                throw new Failure(status, error == null ? "SERVER_RESPONSE" : error.optString("code"), error == null ? "Не удалось выполнить действие" : error.optString("message", "Не удалось выполнить действие"));
            }
            // Accept only our named session cookie, only from authentication responses at the pinned origin.
            if (path.startsWith("/api/partner/auth/")) {
                for (Map.Entry<String, List<String>> header : connection.getHeaderFields().entrySet()) {
                    if (!"Set-Cookie".equalsIgnoreCase(header.getKey())) continue;
                    for (String cookie : header.getValue()) {
                        String first = cookie.split(";", 2)[0];
                        if (!first.startsWith("bs_session=")) continue;
                        String value = first.substring(11);
                        if (value.isEmpty()) forgetSession();
                        else if (value.matches("[a-zA-Z0-9_-]{10,200}")) { store.put("session", value); session = value; }
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
