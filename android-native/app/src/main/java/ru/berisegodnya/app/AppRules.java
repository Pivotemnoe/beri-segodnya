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
    public static String today() { return LocalDate.now(ZoneId.of("Europe/Moscow")).toString(); }
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
