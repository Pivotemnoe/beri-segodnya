package ru.berisegodnya.app;

import java.net.URI;
import java.time.LocalDate;
import java.time.ZoneId;

/** Pure application rules: shared by UI and host-side regression checks. */
public final class AppRules {
    public static final String ORIGIN = "https://berisegodnya.ru";
    private AppRules() { }
    public static String phoneDigits(String value) {
        String digits = value.replaceAll("[^0-9]", "");
        if (digits.length() == 11 && (digits.startsWith("7") || digits.startsWith("8"))) digits = digits.substring(1);
        return digits.length() <= 10 ? digits : digits.substring(0, 10);
    }
    public static String phone(String value) {
        String digits = phoneDigits(value);
        if (digits.length() != 10) throw new IllegalArgumentException("Введите десять цифр после +7");
        return "+7" + digits;
    }
    /** A saved child form returns to its refreshed parent without leaving a duplicate Back entry. */
    public static void completeChildScreen(java.util.Deque<Runnable> history, Runnable parent) {
        if (!history.isEmpty()) history.pop();
        parent.run();
    }
    public static String today() { return LocalDate.now(ZoneId.of("Europe/Moscow")).toString(); }
    /** Display a cached code only; it is never evidence of the current server status. */
    public static String savedBookingCode(String token, java.util.Map<String, String> guestCodes, java.util.Map<String, String> customerCodes, boolean customerSignedIn) {
        if (token == null || token.isEmpty()) return "";
        String guest = guestCodes.get(token);
        if (guest != null && !guest.isEmpty()) return guest;
        return customerSignedIn ? customerCodes.getOrDefault(token, "") : "";
    }
    /** Editing text/photo must never replay a stale stock or publication snapshot. */
    public static final java.util.Set<String> PRESERVED_OFFER_FIELDS = java.util.Collections.unmodifiableSet(new java.util.HashSet<>(java.util.Arrays.asList("id", "addressId", "totalQuantity", "remainingQuantity", "status")));
    public static String friendlyDate(String value) {
        try { return LocalDate.parse(value).format(java.time.format.DateTimeFormatter.ofPattern("d MMMM", java.util.Locale.forLanguageTag("ru-RU"))); }
        catch (Exception error) { return value == null ? "" : value; }
    }
    public static String friendlyTimestamp(String value) {
        try { return java.time.Instant.parse(value).atZone(ZoneId.of("Europe/Moscow")).format(java.time.format.DateTimeFormatter.ofPattern("d MMMM, HH:mm", java.util.Locale.forLanguageTag("ru-RU"))); }
        catch (Exception error) { return value == null ? "" : value; }
    }
    /** The API is pinned to HTTPS. Never accept a lower-priority, non-Host session cookie. */
    public static String sessionCookieValue(String cookie) {
        String first = cookie == null ? "" : cookie.split(";", 2)[0];
        String prefix = "__Host-bs_session=";
        if (!first.startsWith(prefix)) return null;
        String value = first.substring(prefix.length());
        return value.isEmpty() || value.matches("[a-zA-Z0-9_-]{10,200}") ? value : null;
    }
    public static String customerSessionCookieValue(String cookie) {
        String first = cookie == null ? "" : cookie.split(";", 2)[0];
        String prefix = "__Host-bs_customer=";
        if (!first.startsWith(prefix)) return null;
        String value = first.substring(prefix.length());
        return value.isEmpty() || value.matches("[a-zA-Z0-9_-]{43}") ? value : null;
    }
    public static boolean trustedImage(String path) {
        return path != null && path.matches("/(images|uploads)/[a-zA-Z0-9_./-]+\\.(png|jpe?g|webp)") && !path.contains("..");
    }
    public static String bookingToken(String link) {
        try {
            URI uri = URI.create(link);
            if (!"https".equals(uri.getScheme()) || !"berisegodnya.ru".equals(uri.getHost()) || uri.getPort() != -1 || uri.getUserInfo() != null) return "";
            String path = uri.getRawPath();
            return path != null && path.matches("/booking/[a-zA-Z0-9_-]{10,160}") ? path.substring(9) : "";
        } catch (IllegalArgumentException error) { return ""; }
    }
    public static String status(String status) {
        return switch (status) {
            case "created" -> "Забронировано";
            case "issued" -> "Заказ получен";
            case "cancelled" -> "Бронь отменена";
            case "no_show" -> "Заказ не получен";
            case "active" -> "Опубликовано";
            case "paused" -> "Снято с витрины";
            case "sold_out" -> "Всё забронировано";
            case "expired" -> "Выдача завершена";
            default -> "Обновите сведения";
        };
    }
}
