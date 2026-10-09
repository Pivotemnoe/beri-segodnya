package ru.berisegodnya.app;
public final class AppRulesTest {
    private static void equal(String expected, String actual) { if (!expected.equals(actual)) throw new AssertionError(expected + " != " + actual); }
    public static void main(String[] arguments) {
        equal("9991234567", AppRules.phoneDigits("8 (999) 123-45-67"));
        equal("9991234567", AppRules.phoneDigits("+7 (999) 123-45-67"));
        equal("8991234567", AppRules.phoneDigits("8991234567"));
        equal("+79991234567", AppRules.phone("9991234567"));
        equal("9 октября", AppRules.friendlyDate("2026-10-09"));
        equal("9 октября, 12:30", AppRules.friendlyTimestamp("2026-10-09T09:30:00Z"));
        equal("abcde-fghij_12345", AppRules.sessionCookieValue("__Host-bs_session=abcde-fghij_12345; Secure; HttpOnly; Path=/"));
        equal("", AppRules.sessionCookieValue("__Host-bs_session=; Max-Age=0"));
        if (!AppRules.PRESERVED_OFFER_FIELDS.equals(java.util.Set.of("id", "addressId", "totalQuantity", "remainingQuantity", "status"))) throw new AssertionError("An edit can overwrite stock, address or publication state");
        if (AppRules.sessionCookieValue("bs_session=abcde-fghij_12345") != null || AppRules.sessionCookieValue("__Host-bs_session=invalid") != null) throw new AssertionError("Insecure or malformed cookie accepted");
        equal("", AppRules.bookingToken("https://evil.example/booking/booking-view-example"));
        equal("", AppRules.bookingToken("https://berisegodnya.ru@evil.example/booking/booking-view-example"));
        equal("", AppRules.bookingToken("https://berisegodnya.ru:8443/booking/booking-view-example"));
        equal("booking-view-example", AppRules.bookingToken("https://berisegodnya.ru/booking/booking-view-example"));
        if (AppRules.trustedImage("/uploads/../secret.png") || AppRules.trustedImage("https://evil.example/x.png")) throw new AssertionError("Unsafe image URL");
        if (!AppRules.trustedImage("/uploads/partner-1/photo.png")) throw new AssertionError("Valid image rejected");
        try { AppRules.phone("999"); throw new AssertionError("Incomplete phone accepted"); } catch (IllegalArgumentException expected) { }
        System.out.println("Native app rules: PASS");
    }
}
