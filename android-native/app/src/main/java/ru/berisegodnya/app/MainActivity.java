package ru.berisegodnya.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.app.TimePickerDialog;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import androidx.exifinterface.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.inputmethod.InputMethodManager;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/** Real Android Views and native workflows. The shared server, not the device, owns stock and permissions. */
public final class MainActivity extends Activity {
    private static final int INK = 0xff102f38, TEAL = 0xff0b646a, ORANGE = 0xfff34b24, PAPER = 0xfff4f6f2, MUTED = 0xff667b7e;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ExecutorService images = Executors.newFixedThreadPool(2);
    private final ArrayDeque<Runnable> backStack = new ArrayDeque<>();
    private SecureStore store;
    ApiClient api;
    private LinearLayout root, navigation;
    LinearLayout column;
    private TextView heading;
    private android.widget.ProgressBar progress;
    private Runnable currentScreen;
    private String selectedTab = "offers", userRole = "", category = "";
    private int generation;
    private JSONArray savedBookings = new JSONArray();
    private JSONObject pendingBooking, offerDraft = new JSONObject();
    private String editingOffer = "";
    private boolean partnerMode, passwordChangeRequired;
    private boolean mutationInFlight;
    private boolean publicationUncertain;
    boolean adminMode, adminPasswordChangeRequired;
    private AdminScreens admin;

    @FunctionalInterface interface Job { Object run() throws Exception; }
    @FunctionalInterface interface Result { void receive(Object value) throws Exception; }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        // Deliver IME/system-bar insets to our root instead of letting DecorView consume them.
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        store = new SecureStore(this); api = new ApiClient(store); admin = new AdminScreens(this);
        buildShell();
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0, this::back);
        text(column, "Открываем приложение…", 18, MUTED);
        run(() -> {
            store.initialize(); api.restore();
            String bookings = store.get("bookings"), pending = store.get("pending-booking"), draft = store.get("offer-draft");
            publicationUncertain = !store.get("publication-uncertain").isEmpty();
            savedBookings = bookings.isEmpty() ? new JSONArray() : new JSONArray(bookings);
            pendingBooking = pending.isEmpty() ? null : new JSONObject(pending);
            offerDraft = draft.isEmpty() ? new JSONObject() : new JSONObject(draft);
            if (!api.hasSession()) return new JSONObject();
            try { return api.request("GET", "/api/partner/auth/me", null, true); }
            catch (java.io.IOException error) { return json("offline", true); }
            catch (ApiClient.Failure error) {
                if (error.status == 401) return new JSONObject();
                if (error.status >= 500) return json("offline", true);
                throw error;
            }
        }, value -> {
            JSONObject auth = (JSONObject) value;
            if (auth.optBoolean("authenticated")) { userRole = auth.optString("userRole"); passwordChangeRequired = auth.optBoolean("passwordChangeRequired"); }
            else if (!auth.optBoolean("offline")) { api.forgetSession(); clearPartnerState(); }
            String token = tokenFromIntent(getIntent());
            if (!token.isEmpty()) { selectedTab = "bookings"; showBooking(token, true); }
            else if (state != null && state.getBoolean("partnerMode") && api.hasSession()) enterPartner();
            else if (state != null && state.getBoolean("adminMode") && api.hasAdminSession()) admin.login(false);
            else tab(state == null ? "offers" : state.getString("visitorTab", "offers"));
        }, null);
    }

    private void buildShell() {
        root = vertical(); root.setBackgroundColor(PAPER);
        LinearLayout header = horizontal(); header.setGravity(Gravity.CENTER_VERTICAL); header.setPadding(dp(18), dp(12), dp(18), dp(12));
        ImageView logo = new ImageView(this); logo.setImageResource(R.drawable.brand); logo.setContentDescription("Бери сегодня");
        header.addView(logo, new LinearLayout.LayoutParams(dp(42), dp(42)));
        logo.setOnClickListener(view -> new AlertDialog.Builder(this).setTitle("Бери сегодня").setMessage("Предложения на сегодня. Бронь в приложении, оплата в магазине.")
            .setPositiveButton("Понятно", null).setNeutralButton("Лицензии", (dialog, which) -> {
                try (InputStream license = getResources().openRawResource(R.raw.license_lucide)) {
                    new AlertDialog.Builder(this).setTitle("Значки Lucide").setMessage(new String(ApiClient.readLimited(license, 16000), java.nio.charset.StandardCharsets.UTF_8)).setPositiveButton("Закрыть", null).show();
                } catch (Exception error) { message("Не удалось открыть сведения о значках"); }
            }).show());
        LinearLayout brand = vertical(); brand.setPadding(dp(12), 0, 0, 0);
        text(brand, "Бери сегодня", 21, INK).setTypeface(null, Typeface.BOLD);
        text(brand, "Армавир", 13, MUTED); header.addView(brand, new LinearLayout.LayoutParams(0, -2, 1));
        progress = new android.widget.ProgressBar(this); progress.setContentDescription("Сохраняем изменения"); progress.setVisibility(View.GONE);
        header.addView(progress, new LinearLayout.LayoutParams(dp(28), dp(28)));
        root.addView(header);
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.setClipToPadding(false);
        column = vertical(); column.setPadding(dp(18), dp(8), dp(18), dp(22)); scroll.addView(column);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        navigation = horizontal(); navigation.setBackgroundColor(Color.WHITE); navigation.setElevation(dp(6)); navigation.setPadding(dp(6), dp(7), dp(6), dp(7)); root.addView(navigation);
        setContentView(root);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int top, bottom;
            if (Build.VERSION.SDK_INT >= 30) {
                var bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                var keyboard = insets.getInsets(WindowInsets.Type.ime());
                top = bars.top; bottom = Math.max(bars.bottom, keyboard.bottom);
                view.setPadding(Math.max(bars.left, dp(0)), top, bars.right, bottom);
                navigation.setVisibility(insets.isVisible(WindowInsets.Type.ime()) ? View.GONE : View.VISIBLE);
            } else { view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom()); }
            return Build.VERSION.SDK_INT >= 30 ? WindowInsets.CONSUMED : insets;
        });
        root.requestApplyInsets(); rebuildNavigation();
    }

    private void rebuildNavigation() {
        navigation.removeAllViews();
        if (adminMode) {
            nav("admin-overview", "Обзор", R.drawable.ic_dashboard);
            nav("admin-partners", "Заведения", R.drawable.ic_store);
            nav("admin-bookings", "Брони", R.drawable.ic_ticket);
            nav("admin-more", "Ещё", R.drawable.ic_more);
        } else if (!partnerMode) {
            nav("offers", "Предложения", R.drawable.ic_bag);
            nav("bookings", "Мои брони", R.drawable.ic_ticket);
            nav("partner", "Партнёрам", R.drawable.ic_store);
        } else {
            if (!"seller".equals(userRole)) nav("partner-offers", "Предложения", R.drawable.ic_bag);
            nav("codes", "Коды", R.drawable.ic_ticket);
            nav("account", "Кабинет", R.drawable.ic_store);
        }
    }

    private void nav(String key, String title, int icon) {
        LinearLayout item = vertical(); item.setGravity(Gravity.CENTER); item.setPadding(dp(4), dp(7), dp(4), dp(7));
        boolean selected = key.equals(selectedTab); item.setBackground(shape(selected ? 0xffe5f1ed : Color.WHITE, 14, 0));
        ImageView image = new ImageView(this); image.setImageResource(icon); image.setImageTintList(ColorStateList.valueOf(selected ? TEAL : MUTED));
        item.addView(image, new LinearLayout.LayoutParams(dp(24), dp(24)));
        TextView label = text(item, title, 12, selected ? TEAL : MUTED); label.setGravity(Gravity.CENTER); label.setPadding(0, dp(4), 0, 0);
        if (selected) label.setTypeface(null, Typeface.BOLD);
        item.setContentDescription(title); item.setOnClickListener(view -> tab(key));
        navigation.addView(item, new LinearLayout.LayoutParams(0, -2, 1));
    }

    private void tab(String key) {
        if (mutationInFlight) { message("Подождите, сохраняем изменения…"); return; }
        hideKeyboard(); backStack.clear(); selectedTab = key; rebuildNavigation();
        switch (key) {
            case "admin-overview" -> admin.overview(false);
            case "admin-partners" -> admin.partners(false);
            case "admin-bookings" -> admin.bookings(false);
            case "admin-more" -> admin.more(false);
            case "bookings" -> showBookings();
            case "partner" -> showPartnerEntrance();
            case "partner-offers" -> showPartnerOffers();
            case "codes" -> showCodes();
            case "account" -> showAccount();
            default -> showOffers();
        }
    }

    void screen(String title, Runnable refresh, boolean child) {
        hideKeyboard();
        if (child && currentScreen != null) backStack.push(currentScreen);
        currentScreen = refresh; generation++; column.removeAllViews();
        if (!backStack.isEmpty()) button(column, "Назад", false, this::back);
        heading = text(column, title, 28, INK); heading.setTypeface(null, Typeface.BOLD); heading.setPadding(0, dp(12), 0, dp(14));
        rebuildNavigation();
        if (android.animation.ValueAnimator.areAnimatorsEnabled()) {
            column.animate().cancel(); column.setAlpha(0); column.setTranslationY(dp(10));
            column.animate().alpha(1).translationY(0).setDuration(160).start();
        }
    }

    private void back() {
        if (mutationInFlight) { message("Подождите, сохраняем изменения…"); return; }
        if (!backStack.isEmpty()) backStack.pop().run();
        else if (adminMode) admin.exitToCustomer();
        else if (partnerMode) new AlertDialog.Builder(this).setTitle("Вернуться к предложениям для покупателей?").setPositiveButton("Перейти", (dialog, which) -> { partnerMode = false; tab("offers"); }).setNegativeButton("Остаться", null).show();
        else if (!selectedTab.equals("offers")) tab("offers");
        else finish();
    }
    // API 33+ uses the platform OnBackInvokedDispatcher registered in onCreate.
    // This override is solely the required Android 8–12 fallback, not the gesture path.
    @android.annotation.SuppressLint("GestureBackNavigation")
    @SuppressWarnings("deprecation") @Override public void onBackPressed() { if (Build.VERSION.SDK_INT < 33) back(); }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); String token = tokenFromIntent(intent); if (!token.isEmpty() && !mutationInFlight) { partnerMode = false; adminMode = false; selectedTab = "bookings"; backStack.clear(); showBooking(token, true); } }
    private String tokenFromIntent(Intent intent) { return intent != null && intent.getData() != null ? AppRules.bookingToken(intent.getData().toString()) : ""; }

    private void showOffers() {
        screen("Что забрать сегодня", this::showOffers, false);
        text(column, "Забронируйте здесь. Заберите и оплатите в магазине.", 16, MUTED);
        Spinner filter = choices(column, new String[]{"Всё", "Обеды", "Выпечка", "Вечерние наборы"}, switch (category) { case "lunch" -> 1; case "bakery" -> 2; case "evening" -> 3; default -> 0; });
        button(column, "Показать предложения", false, () -> { category = new String[]{"", "lunch", "bakery", "evening"}[filter.getSelectedItemPosition()]; showOffers(); });
        if (pendingBooking != null) {
            LinearLayout warning = card(column); text(warning, "Проверим незавершённую бронь", 19, INK);
            text(warning, "Если связь оборвалась, повторная проверка не создаст второй заказ.", 15, MUTED);
            button(warning, "Проверить бронь", true, () -> submitBooking(pendingBooking));
        }
        TextView loading = text(column, "Ищем предложения…", 16, MUTED);
        run(() -> api.request("GET", "/api/public/offers" + (category.isEmpty() ? "" : "?category=" + category), null, false), value -> {
            column.removeView(loading); JSONArray offers = (JSONArray) value;
            if (offers.length() == 0) {
                LinearLayout empty = card(column); text(empty, "На сегодня пока нет предложений", 22, INK).setTypeface(null, Typeface.BOLD);
                text(empty, "Заведения добавят их сюда, когда будут готовы. Можно заглянуть позже.", 16, MUTED);
            }
            for (int i = 0; i < offers.length(); i++) {
                JSONObject offer = offers.getJSONObject(i); LinearLayout item = card(column);
                picture(item, offer.optString("imageUrl"), offer.optString("title"));
                text(item, offer.optString("partnerName"), 14, MUTED);
                text(item, offer.optString("title"), 21, INK).setTypeface(null, Typeface.BOLD);
                text(item, money(offer, "price") + " · " + offer.optString("pickupWindow"), 18, TEAL);
                text(item, "Осталось: " + offer.optInt("remaining"), 14, MUTED);
                button(item, "Посмотреть и забронировать", true, () -> showOffer(offer.optString("id"), true));
            }
            button(column, "Обновить", false, this::showOffers);
        }, null);
    }

    private void showOffer(String id, boolean child) {
        screen("Предложение", () -> showOffer(id, false), child);
        run(() -> api.request("GET", "/api/public/offers/" + id, null, false), value -> {
            JSONObject offer = (JSONObject) value; heading.setText(offer.optString("title"));
            picture(column, offer.optString("imageUrl"), offer.optString("title"));
            text(column, offer.optString("partnerName"), 18, INK);
            text(column, money(offer, "price"), 30, TEAL).setTypeface(null, Typeface.BOLD);
            details(column, "В наборе", offer.optString("contents"));
            details(column, "Описание", offer.optString("description"));
            details(column, "Вес", offer.optString("weight"));
            details(column, "Аллергены", offer.optString("allergens"));
            details(column, "Где забрать", offer.optString("address"));
            details(column, "Время выдачи", offer.optString("pickupWindow"));
            text(column, "Осталось: " + offer.optInt("remaining"), 16, MUTED);
            button(column, "Забронировать", true, () -> bookingForm(offer, true));
        }, null);
    }

    private void bookingForm(JSONObject offer, boolean child) {
        screen("Забронировать", () -> bookingForm(offer, false), child);
        text(column, offer.optString("title") + " · " + money(offer, "price"), 20, INK);
        text(column, offer.optString("pickupWindow") + " · " + offer.optString("address"), 16, MUTED);
        EditText name = field(column, "Ваше имя", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS, 80);
        EditText phone = phoneField(column, "Телефон", "");
        legalLinks(column, false);
        CheckBox consent = check(column, "Я согласен на обработку персональных данных и принимаю политику конфиденциальности");
        Button submit = button(column, "Получить код брони", true, () -> {
            try {
                if (name.getText().toString().trim().isEmpty()) throw new IllegalArgumentException("Укажите ваше имя");
                if (!consent.isChecked()) throw new IllegalArgumentException("Для бронирования нужно согласие на обработку данных");
                if (pendingBooking != null) { message("Сначала проверьте незавершённую бронь в разделе «Предложения»"); return; }
                JSONObject payload = json("offerId", offer.getString("id"), "customerName", name.getText().toString().trim(), "customerPhone", AppRules.phone(phone.getText().toString()), "personalDataConsent", true, "requestId", UUID.randomUUID().toString());
                submitBooking(payload);
            } catch (Exception error) { message(error.getMessage()); }
        });
        text(column, "Оплата в магазине. Код появится в разделе «Мои брони».", 15, MUTED);
    }

    private void submitBooking(JSONObject payload) {
        pendingBooking = payload;
        screen("Получаем код брони", () -> submitBooking(payload), false);
        text(column, "Не закрывайте этот экран, пока проверяем наличие.", 16, MUTED);
        mutate(() -> {
            store.put("pending-booking", payload.toString()); pendingBooking = payload;
            try {
                JSONObject result = (JSONObject) api.request("POST", "/api/public/bookings", payload, false);
                rememberBooking(result.getString("publicToken"), result);
                store.remove("pending-booking"); pendingBooking = null; return result;
            } catch (ApiClient.Failure error) {
                if (error.status >= 400 && error.status < 500 && error.status != 429) { store.remove("pending-booking"); pendingBooking = null; }
                throw error;
            }
        }, value -> { selectedTab = "bookings"; backStack.clear(); showBooking(((JSONObject) value).getString("publicToken"), false); }, null);
        button(column, "К предложениям", false, () -> tab("offers"));
    }

    private void rememberBooking(String token, JSONObject snapshot) throws Exception {
        JSONArray next = new JSONArray();
        next.put(json("token", token, "code", snapshot.optString("code"), "offerTitle", snapshot.optString("offerTitle"), "address", snapshot.optString("address"), "pickupWindow", snapshot.optString("pickupWindow"), "date", snapshot.optString("date")));
        for (int i = 0; i < savedBookings.length() && next.length() < 50; i++) {
            JSONObject old = savedBookings.getJSONObject(i); if (!token.equals(old.optString("token"))) next.put(old);
        }
        store.put("bookings", next.toString()); savedBookings = next;
    }

    private void showBookings() {
        screen("Мои брони", this::showBookings, false);
        text(column, "Ваши коды сохраняются на этом телефоне. Статус брони проверяем у заведения.", 16, MUTED);
        if (savedBookings.length() == 0) {
            text(column, "Здесь будут ваши заказы", 22, INK);
            button(column, "Выбрать предложение", true, () -> tab("offers"));
        }
        for (int i = 0; i < savedBookings.length(); i++) {
            JSONObject item = savedBookings.optJSONObject(i); if (item == null) continue;
            LinearLayout row = card(column);
            text(row, item.optString("offerTitle", "Ваша бронь").isEmpty() ? "Ваша бронь" : item.optString("offerTitle"), 21, INK);
            text(row, item.optString("code"), 27, TEAL).setTypeface(null, Typeface.BOLD);
            text(row, AppRules.friendlyDate(item.optString("date")) + " " + item.optString("pickupWindow"), 16, MUTED);
            button(row, "Открыть бронь", true, () -> showBooking(item.optString("token"), true));
        }
    }

    private void showBooking(String token, boolean child) {
        screen("Ваша бронь", () -> showBooking(token, false), child);
        TextView loading = text(column, "Проверяем бронь…", 16, MUTED);
        run(() -> {
            JSONObject booking = (JSONObject) api.request("GET", "/api/public/bookings/" + token, null, false);
            rememberBooking(token, booking); return booking;
        }, value -> {
            column.removeView(loading); JSONObject booking = (JSONObject) value;
            LinearLayout ticket = card(column);
            text(ticket, AppRules.status(booking.optString("status")), 17, TEAL);
            text(ticket, booking.optString("code"), 42, INK).setTypeface(null, Typeface.BOLD);
            text(ticket, booking.optString("offerTitle"), 22, INK);
            details(ticket, "Заведение", booking.optString("partnerName"));
            details(ticket, "Где забрать", booking.optString("address"));
            details(ticket, "Когда", AppRules.friendlyDate(booking.optString("date")) + " · " + booking.optString("pickupWindow"));
            if (booking.optBoolean("termsVerified")) details(ticket, "Цена", money(booking, "price"));
            details(ticket, "Состав", booking.optString("contents"));
            details(ticket, "Аллергены", booking.optString("allergens"));
            if ("created".equals(booking.optString("status"))) {
                text(ticket, "Покажите код сотруднику. Оплатите в магазине.", 17, MUTED);
                button(ticket, "Отправить код", false, () -> shareCode(booking));
                button(column, "Отменить бронь", false, () -> new AlertDialog.Builder(this).setTitle("Отменить эту бронь?")
                    .setMessage("Набор снова смогут заказать другие покупатели.").setNegativeButton("Оставить", null)
                    .setPositiveButton("Отменить бронь", (dialog, which) -> mutate(() -> api.request("POST", "/api/public/bookings/" + token + "/cancel", new JSONObject(), false), result -> showBooking(token, false), null)).show());
            }
            button(column, "Обновить статус", false, () -> showBooking(token, false));
        }, null);
        for (int i = 0; i < savedBookings.length(); i++) {
            JSONObject saved = savedBookings.optJSONObject(i);
            if (saved != null && token.equals(saved.optString("token"))) {
                text(column, "Сохранённый код: " + saved.optString("code") + ". Сам по себе код не подтверждает, что бронь ещё действует.", 14, MUTED); break;
            }
        }
    }

    private void shareCode(JSONObject booking) {
        Intent share = new Intent(Intent.ACTION_SEND); share.setType("text/plain");
        share.putExtra(Intent.EXTRA_TEXT, "Бери сегодня\nКод: " + booking.optString("code") + "\n" + booking.optString("offerTitle") + "\n" + AppRules.friendlyDate(booking.optString("date")) + " " + booking.optString("pickupWindow") + "\n" + booking.optString("address"));
        startActivity(Intent.createChooser(share, "Отправить код"));
    }

    private void showPartnerEntrance() {
        screen("Партнёрам", this::showPartnerEntrance, false);
        LinearLayout login = card(column); text(login, "Уже работаете с нами?", 23, INK).setTypeface(null, Typeface.BOLD);
        text(login, "Вход для владельца, менеджера и продавца заведения.", 16, MUTED);
        button(login, api.hasSession() ? "Открыть мой кабинет" : "Войти в кабинет", true, () -> {
            if (api.hasSession()) enterPartner(); else showLogin(true);
        });
        LinearLayout application = card(column); text(application, "Хотите подключить заведение?", 21, INK);
        text(application, "Оставьте контакты — обсудим запуск и поможем разместить первое предложение.", 16, MUTED);
        button(application, "Оставить заявку", false, () -> showApplication(true));
        button(column, "Вход администратора проекта", false, () -> admin.login(true));
    }

    private void showLogin(boolean child) {
        screen("Вход для партнёра", () -> showLogin(false), child);
        text(column, "Используйте логин и пароль, которые получили при подключении заведения.", 16, MUTED);
        EditText login = field(column, "Логин", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS, 120); login.setAutofillHints(View.AUTOFILL_HINT_USERNAME);
        EditText password = passwordField(column, "Пароль");
        Button submit = new Button(this);
        styleButton(submit, "Войти", true); addSpace(column, submit);
        submit.setOnClickListener(view -> {
            String user = login.getText().toString().trim(), pass = password.getText().toString();
            if (user.isEmpty() || pass.isEmpty()) { message("Введите логин и пароль"); return; }
            mutate(() -> api.request("POST", "/api/partner/auth/login", json("login", user, "password", pass), false), value -> {
                password.setText(""); JSONObject auth = (JSONObject) value;
                userRole = auth.optString("userRole"); passwordChangeRequired = auth.optBoolean("passwordChangeRequired"); enterPartner();
            }, submit);
        });
        text(column, "Не получается войти? Напишите администратору проекта — он поможет восстановить доступ.", 15, MUTED);
    }

    private void enterPartner() {
        if (userRole.isEmpty()) {
            run(() -> api.request("GET", "/api/partner/auth/me", null, true), value -> {
                JSONObject auth = (JSONObject) value;
                if (!auth.optBoolean("authenticated")) { api.forgetSession(); clearPartnerState(); showLogin(false); return; }
                userRole = auth.optString("userRole"); passwordChangeRequired = auth.optBoolean("passwordChangeRequired"); enterPartner();
            }, null);
            return;
        }
        partnerMode = true; backStack.clear();
        if (!"owner".equals(userRole) && !"manager".equals(userRole) && !"seller".equals(userRole)) { api.forgetSession(); clearPartnerState(); partnerMode = false; showLogin(false); message("Доступ изменён. Войдите заново или обратитесь к администратору."); return; }
        if (passwordChangeRequired) { selectedTab = "account"; showChangePassword(false); }
        else tab("seller".equals(userRole) ? "codes" : "partner-offers");
    }

    private void showApplication(boolean child) {
        screen("Подключить заведение", () -> showApplication(false), child);
        EditText venue = field(column, "Название заведения", "", InputType.TYPE_CLASS_TEXT, 120);
        text(column, "Тип заведения", 15, INK);
        Spinner type = choices(column, new String[]{"Пекарня", "Кулинария", "Буфет", "Кофейня", "Кафе готовой еды", "Другое"}, 0);
        EditText city = field(column, "Город", "Армавир", InputType.TYPE_CLASS_TEXT, 80);
        EditText address = field(column, "Адрес первой точки", "", InputType.TYPE_CLASS_TEXT, 160);
        EditText contact = field(column, "Как к вам обращаться", "", InputType.TYPE_CLASS_TEXT, 80);
        EditText phone = phoneField(column, "Телефон", "");
        EditText email = field(column, "Email — по желанию", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS, 120);
        EditText comment = field(column, "Что хотите размещать или спросить", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE, 1000);
        legalLinks(column, true);
        CheckBox personal = check(column, "Я согласен на обработку персональных данных и принимаю политику конфиденциальности");
        CheckBox terms = check(column, "Я принимаю условия подключения партнёров");
        Button submit = new Button(this); styleButton(submit, "Отправить заявку", true); addSpace(column, submit);
        submit.setOnClickListener(view -> {
            try {
                if (!personal.isChecked() || !terms.isChecked()) throw new IllegalArgumentException("Подтвердите согласие и условия подключения");
                JSONObject data = json("venueName", venue.getText().toString(), "venueType", new String[]{"bakery", "culinary", "buffet", "coffee", "ready_food_cafe", "other"}[type.getSelectedItemPosition()], "city", city.getText().toString(), "firstAddress", address.getText().toString(), "contactName", contact.getText().toString(), "phone", AppRules.phone(phone.getText().toString()), "email", email.getText().toString(), "comment", comment.getText().toString(), "locationsCount", "1", "offerFormats", new JSONArray(), "personalDataConsent", true, "partnerTermsConsent", true);
                mutate(() -> api.request("POST", "/api/public/partner-applications", data, false), value -> {
                    screen("Заявка отправлена", this::showPartnerEntrance, false); text(column, "Спасибо! Свяжемся с вами и обсудим подключение.", 20, INK);
                    button(column, "Готово", true, () -> tab("partner"));
                }, submit);
            } catch (Exception error) { message(error.getMessage()); }
        });
    }

    private boolean partnerGuard() {
        if (!api.hasSession()) { clearPartnerState(); partnerMode = false; selectedTab = "partner"; showLogin(false); return false; }
        if (passwordChangeRequired) { showChangePassword(false); return false; }
        return true;
    }

    private void showPartnerOffers() {
        if (!partnerGuard()) return;
        screen("Предложения заведения", this::showPartnerOffers, false);
        if (publicationUncertain) {
            LinearLayout warning = card(column); text(warning, "Проверьте последнюю публикацию", 21, INK);
            text(warning, "Ответ не пришёл. Предложение могло сохраниться. Посмотрите список ниже, прежде чем публиковать снова.", 16, MUTED);
            button(warning, "Я проверил список", false, () -> new AlertDialog.Builder(this).setTitle("Проверили последнюю публикацию?")
                .setMessage("Если предложение уже есть в списке, измените его. Не создавайте второй экземпляр.").setNegativeButton("Ещё проверю", null)
                .setPositiveButton("Проверил", (dialog, which) -> { publicationUncertain = false; store.remove("publication-uncertain"); showPartnerOffers(); }).show());
        }
        button(column, "Добавить предложение", true, () -> showOfferEditor("", true));
        run(() -> api.request("GET", "/api/partner/offers", null, true), value -> {
            JSONArray offers = (JSONArray) value;
            if (offers.length() == 0) text(column, "Добавьте первый набор: фото, состав, цену и время выдачи.", 18, MUTED);
            for (int i = offers.length() - 1; i >= 0; i--) {
                JSONObject offer = offers.getJSONObject(i); LinearLayout card = card(column);
                picture(card, offer.optString("image_url"), offer.optString("title"));
                text(card, offer.optString("title"), 21, INK).setTypeface(null, Typeface.BOLD);
                text(card, AppRules.status(offer.optString("status")), 16, TEAL);
                text(card, money(offer, "price") + " · " + AppRules.friendlyDate(offer.optString("date")) + " · " + offer.optString("pickup_window"), 16, MUTED);
                text(card, "Доступно: " + offer.optInt("remaining_quantity") + " из " + offer.optInt("total_quantity"), 16, MUTED);
                button(card, "Изменить", false, () -> editExistingOffer(offer));
                boolean active = "active".equals(offer.optString("status"));
                button(card, active ? "Снять с витрины" : "Опубликовать", false, () -> new AlertDialog.Builder(this).setTitle(active ? "Снять предложение с витрины?" : "Опубликовать предложение?")
                    .setMessage("Уже оформленные брони сохранятся.").setNegativeButton("Не менять", null)
                    .setPositiveButton("Подтвердить", (dialog, which) -> mutate(() -> api.request("PATCH", "/api/partner/offers/" + offer.getString("id") + "/status", json("status", active ? "paused" : "active"), true), result -> showPartnerOffers(), null)).show());
            }
            button(column, "Обновить", false, this::showPartnerOffers);
        }, null);
    }

    private void editExistingOffer(JSONObject offer) {
        offerDraft = json("id", offer.optString("id"), "addressId", offer.optString("address_id"), "title", offer.optString("title"), "category", offer.optString("category"), "price", offer.opt("price"), "oldPrice", offer.isNull("old_price") ? "" : offer.optString("old_price"), "contents", offer.optString("contents"), "allergens", offer.optString("allergens"), "date", offer.optString("date"), "pickupWindow", offer.optString("pickup_window"), "totalQuantity", offer.optInt("total_quantity"), "remainingQuantity", offer.optInt("remaining_quantity"), "imageUrls", offer.optJSONArray("image_urls") == null ? new JSONArray() : offer.optJSONArray("image_urls"), "status", offer.optString("status"));
        saveDraft(); showOfferEditor(offer.optString("id"), true);
    }

    private void showOfferEditor(String id, boolean child) {
        if (!partnerGuard()) return;
        editingOffer = id;
        if (!id.equals(offerDraft.optString("id"))) offerDraft = new JSONObject();
        screen(id.isEmpty() ? "Новое предложение" : "Изменить предложение", () -> showOfferEditor(id, false), child);
        final LinearLayout form = column;
        run(() -> api.request("GET", "/api/partner/addresses", null, true), value -> {
            JSONArray addresses = (JSONArray) value; List<JSONObject> active = new ArrayList<>();
            for (int i = 0; i < addresses.length(); i++) if (addresses.getJSONObject(i).optBoolean("is_active", true) || addresses.getJSONObject(i).optString("id").equals(offerDraft.optString("addressId"))) active.add(addresses.getJSONObject(i));
            if (active.isEmpty()) { text(form, "Владелец должен добавить адрес, где вы будете выдавать заказы.", 18, MUTED); if ("owner".equals(userRole)) button(form, "Добавить точку", true, () -> showAddressForm(true)); return; }
            String[] labels = new String[active.size()]; int selected = 0;
            for (int i = 0; i < active.size(); i++) { labels[i] = active.get(i).optString("title") + " · " + active.get(i).optString("address"); if (active.get(i).optString("id").equals(offerDraft.optString("addressId"))) selected = i; }
            text(form, "Где выдавать", 15, INK); Spinner address = choices(form, labels, selected);
            if (!id.isEmpty()) { address.setEnabled(false); text(form, "У размещённого предложения точка остаётся прежней. Для другого адреса добавьте новое предложение.", 14, MUTED); }
            address.setOnItemSelectedListener(selection(position -> putDraft("addressId", active.get(position).optString("id"))));
            EditText title = draftField(form, "title", "Название предложения", 120, false);
            text(form, "Категория", 15, INK); String[] keys = {"lunch", "bakery", "evening"}; int selectedCategory = 0;
            for (int i = 0; i < keys.length; i++) if (keys[i].equals(offerDraft.optString("category"))) selectedCategory = i;
            Spinner kind = choices(form, new String[]{"Обеды", "Выпечка", "Вечерние наборы"}, selectedCategory);
            kind.setOnItemSelectedListener(selection(position -> putDraft("category", keys[position])));
            EditText contents = draftField(form, "contents", "Состав набора", 500, false);
            EditText allergens = draftField(form, "allergens", "Аллергены", 240, false);
            EditText price = draftField(form, "price", "Цена, ₽", 8, true);
            EditText oldPrice = draftField(form, "oldPrice", "Обычная цена, ₽ — по желанию", 8, true);
            EditText quantity = draftField(form, "totalQuantity", "Количество наборов", 5, true);
            if (!id.isEmpty()) { quantity.setEnabled(false); text(form, "Количество уже размещённого предложения здесь не меняется, чтобы не затронуть брони.", 14, MUTED); }
            String dateValue = offerDraft.optString("date", AppRules.today());
            if (dateValue.isEmpty()) dateValue = AppRules.today(); putDraft("date", dateValue);
            Button date = button(form, "Дата: " + AppRules.friendlyDate(dateValue), false, () -> {
                LocalDate initial;
                try { initial = LocalDate.parse(offerDraft.optString("date", AppRules.today())); } catch (Exception error) { initial = LocalDate.parse(AppRules.today()); }
                new DatePickerDialog(this, (picker, year, month, day) -> { putDraft("date", LocalDate.of(year, month + 1, day).toString()); showOfferEditor(id, false); }, initial.getYear(), initial.getMonthValue() - 1, initial.getDayOfMonth()).show();
            });
            text(form, "Время выдачи", 15, INK);
            EditText pickup = field(form, "Начало и конец", offerDraft.optString("pickupWindow", "15:00–18:00"), InputType.TYPE_CLASS_TEXT, 40);
            pickup.setKeyListener(null); pickup.setOnClickListener(view -> pickTimes(pickup));
            pickup.addTextChangedListener(watcher(() -> putDraft("pickupWindow", pickup.getText().toString())));
            JSONArray urls = offerDraft.optJSONArray("imageUrls");
            text(form, urls != null && urls.length() > 0 ? "Фото добавлено" : "Добавьте фото вашего набора", 16, INK);
            if (urls != null && urls.length() > 0) picture(form, urls.optString(0), "Фото набора");
            button(form, "Выбрать фото с телефона", false, () -> {
                putDraft("addressId", active.get(address.getSelectedItemPosition()).optString("id")); putDraft("category", keys[kind.getSelectedItemPosition()]);
                Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT); picker.setType("image/*"); picker.addCategory(Intent.CATEGORY_OPENABLE); picker.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivityForResult(picker, 40);
            });
            text(form, "Выбирайте своё фото. Мы уменьшим его перед загрузкой.", 14, MUTED);
            Button preview = button(form, "Проверить перед публикацией", true, () -> {
                try {
                    if (title.getText().toString().trim().isEmpty() || contents.getText().toString().trim().isEmpty()) throw new IllegalArgumentException("Укажите название и состав набора");
                    int count = Integer.parseInt(quantity.getText().toString()); double amount = Double.parseDouble(price.getText().toString().replace(',', '.'));
                    String originalPrice = oldPrice.getText().toString().trim();
                    double previousAmount = originalPrice.isEmpty() ? 0 : Double.parseDouble(originalPrice.replace(',', '.'));
                    if (!Double.isFinite(amount) || !Double.isFinite(previousAmount) || previousAmount < 0 || previousAmount > 100000 || (previousAmount != 0 && previousAmount <= amount)) throw new IllegalArgumentException("Обычная цена должна быть выше цены предложения. Можно оставить её пустой.");
                    if (count < 1 || count > 10000 || amount < 1 || amount > 100000) throw new IllegalArgumentException("Проверьте цену и количество");
                    String[] times = pickup.getText().toString().split("–");
                    if (times.length != 2 || !LocalTime.parse(times[1]).isAfter(LocalTime.parse(times[0]))) throw new IllegalArgumentException("Конец выдачи должен быть позже начала");
                    if (offerDraft.optJSONArray("imageUrls") == null || offerDraft.optJSONArray("imageUrls").length() == 0) throw new IllegalArgumentException("Добавьте фото набора");
                    JSONObject data = new JSONObject(offerDraft.toString()); data.remove("id");
                    data.put("addressId", active.get(address.getSelectedItemPosition()).getString("id")); data.put("category", keys[kind.getSelectedItemPosition()]);
                    data.put("price", amount); data.put("totalQuantity", count); data.put("pickupWindow", pickup.getText().toString());
                    data.put("oldPrice", previousAmount == 0 ? "" : previousAmount);
                    if (id.isEmpty()) { data.put("remainingQuantity", count); data.put("status", "active"); }
                    data.put("sourceType", "manual");
                    putDraft("addressId", data.getString("addressId")); putDraft("category", data.getString("category")); saveDraft();
                    previewOffer(data, id, true);
                } catch (Exception error) { message(error instanceof NumberFormatException ? "Введите цену и количество цифрами" : error.getMessage()); }
            });
            button(form, "Очистить черновик", false, () -> new AlertDialog.Builder(this).setTitle("Удалить только этот черновик?").setNegativeButton("Оставить", null)
                .setPositiveButton("Удалить", (dialog, which) -> { offerDraft = new JSONObject(); saveDraft(); showOfferEditor("", false); }).show());
        }, null);
    }

    private void previewOffer(JSONObject data, String id, boolean child) {
        screen("Проверьте предложение", () -> previewOffer(data, id, false), child);
        JSONArray urls = data.optJSONArray("imageUrls"); if (urls != null && urls.length() > 0) picture(column, urls.optString(0), data.optString("title"));
        text(column, data.optString("title"), 24, INK).setTypeface(null, Typeface.BOLD);
        text(column, money(data, "price") + " · наборов: " + data.optInt("totalQuantity"), 21, TEAL);
        details(column, "Состав", data.optString("contents")); details(column, "Аллергены", data.optString("allergens"));
        details(column, "Выдача", AppRules.friendlyDate(data.optString("date")) + " · " + data.optString("pickupWindow"));
        text(column, id.isEmpty() ? "После подтверждения предложение появится у покупателей." : "Условия ранее оформленных броней останутся прежними.", 16, MUTED);
        Button submit = new Button(this); styleButton(submit, id.isEmpty() ? "Опубликовать предложение" : "Сохранить изменения", true); addSpace(column, submit);
        submit.setOnClickListener(view -> {
            if (id.isEmpty() && publicationUncertain) { message("Сначала проверьте предыдущую публикацию в разделе «Предложения»"); tab("partner-offers"); return; }
            mutate(() -> {
                if (id.isEmpty()) { store.put("publication-uncertain", "pending"); publicationUncertain = true; }
                try {
                    JSONObject payload = new JSONObject(data.toString());
                    if (!id.isEmpty()) for (String field : AppRules.PRESERVED_OFFER_FIELDS) payload.remove(field);
                    Object result = api.request(id.isEmpty() ? "POST" : "PATCH", "/api/partner/offers" + (id.isEmpty() ? "" : "/" + id), payload, true);
                    store.remove("publication-uncertain"); publicationUncertain = false; return result;
                } catch (ApiClient.Failure error) {
                    if (error.status >= 400 && error.status < 500 && error.status != 429) { store.remove("publication-uncertain"); publicationUncertain = false; }
                    throw error;
                }
            }, value -> {
            offerDraft = new JSONObject(); store.remove("offer-draft"); message("Предложение сохранено"); tab("partner-offers");
            }, submit);
        });
    }

    private EditText draftField(LinearLayout parent, String key, String label, int length, boolean numeric) {
        EditText field = field(parent, label, offerDraft.optString(key), numeric ? InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL : InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE, length);
        field.addTextChangedListener(watcher(() -> putDraft(key, field.getText().toString()))); return field;
    }
    private void putDraft(String key, Object value) { try { offerDraft.put(key, value); } catch (Exception error) { message("Не удалось сохранить черновик"); } }
    private void saveDraft() {
        String draft = offerDraft.toString(); worker.execute(() -> { try { store.put("offer-draft", draft); } catch (Exception error) { runOnUiThread(() -> message("Не удалось сохранить черновик на телефоне")); } });
    }
    @Override protected void onPause() { if (store != null && partnerMode && !offerDraft.toString().equals("{}")) saveDraft(); super.onPause(); }

    private void pickTimes(EditText target) {
        new TimePickerDialog(this, (picker, hour, minute) -> {
            String start = java.time.LocalTime.of(hour, minute).toString();
            new TimePickerDialog(this, (endPicker, endHour, endMinute) -> target.setText(String.format(java.util.Locale.ROOT, "%s–%s", start, java.time.LocalTime.of(endHour, endMinute))), Math.min(hour + 2, 23), minute, true).show();
        }, 15, 0, true).show();
    }

    @SuppressWarnings("deprecation") @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != 40 || result != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData(); String offerId = editingOffer;
        screen("Добавляем фото", () -> showOfferEditor(offerId, false), false);
        text(column, "Уменьшаем фотографию и загружаем её в ваше заведение…", 17, MUTED);
        mutate(() -> {
            byte[] original;
            try (InputStream input = getContentResolver().openInputStream(uri)) { original = ApiClient.readLimited(input, 20 * 1024 * 1024); }
            BitmapFactory.Options options = new BitmapFactory.Options(); options.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(original, 0, original.length, options);
            if (options.outWidth <= 0 || options.outHeight <= 0) throw new IllegalArgumentException("Не удалось прочитать фото. Выберите JPEG или PNG.");
            options.inJustDecodeBounds = false; options.inSampleSize = 1;
            while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > 1600) options.inSampleSize *= 2;
            Bitmap bitmap = BitmapFactory.decodeByteArray(original, 0, original.length, options);
            if (bitmap == null) throw new IllegalArgumentException("Не удалось открыть фото");
            try {
                Matrix transform = new Matrix();
                try (InputStream exifInput = new ByteArrayInputStream(original)) {
                    ExifInterface exif = new ExifInterface(exifInput); int orientation = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, 1);
                    switch (orientation) {
                        case 2 -> transform.setScale(-1, 1);
                        case 3 -> transform.setRotate(180);
                        case 4 -> transform.setScale(1, -1);
                        case 5 -> { transform.setRotate(90); transform.postScale(-1, 1); }
                        case 6 -> transform.setRotate(90);
                        case 7 -> { transform.setRotate(270); transform.postScale(-1, 1); }
                        case 8 -> transform.setRotate(270);
                        default -> { }
                    }
                } catch (java.io.IOException ignored) { /* Non-JPEG formats have no supported EXIF. */ }
                Bitmap rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), transform, true);
                if (rotated != bitmap) { bitmap.recycle(); bitmap = rotated; }
                ByteArrayOutputStream bytes = new ByteArrayOutputStream(); bitmap.compress(Bitmap.CompressFormat.JPEG, 84, bytes);
                JSONObject uploaded = (JSONObject) api.request("POST", "/api/partner/uploads", json("images", new JSONArray().put(json("dataUrl", "data:image/jpeg;base64," + android.util.Base64.encodeToString(bytes.toByteArray(), android.util.Base64.NO_WRAP), "capturedAt", Instant.now().toString()))), true);
                return uploaded.getJSONArray("images").getJSONObject(0);
            } finally { bitmap.recycle(); }
        }, value -> { JSONObject photo = (JSONObject) value; putDraft("imageUrls", new JSONArray().put(photo.getString("url"))); putDraft("photoCapturedAt", photo.getString("capturedAt")); saveDraft(); showOfferEditor(offerId, false); }, null);
    }

    private void showCodes() {
        if (!partnerGuard()) return;
        screen("Проверить код покупателя", this::showCodes, false);
        text(column, "Найдите бронь по коду. Отмечайте выдачу только после того, как передали заказ покупателю.", 16, MUTED);
        EditText code = field(column, "Код брони", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS, 12);
        LinearLayout results = vertical(); column.addView(results);
        Button search = button(column, "Найти бронь", true, () -> {
            String query = code.getText().toString().replaceAll("\\s", "").toUpperCase(java.util.Locale.ROOT);
            if (query.isEmpty()) { message("Введите код, который показывает покупатель"); return; }
            results.removeAllViews();
            run(() -> api.request("GET", "/api/partner/bookings", null, true), value -> {
                JSONArray bookings = (JSONArray) value; boolean found = false;
                for (int i = 0; i < bookings.length(); i++) {
                    JSONObject booking = bookings.getJSONObject(i);
                    if (!query.equals(booking.optString("code"))) continue; found = true; codeCard(results, booking);
                }
                if (!found) text(results, "Такого кода у вашего заведения нет. Проверьте цифры и название магазина.", 18, MUTED);
            }, null);
        });
    }

    private void codeCard(LinearLayout parent, JSONObject booking) {
        LinearLayout card = card(parent);
        text(card, booking.optString("code"), 32, INK).setTypeface(null, Typeface.BOLD);
        text(card, booking.optString("offerTitle"), 21, INK); text(card, AppRules.status(booking.optString("status")), 17, TEAL);
        details(card, "Время выдачи", AppRules.friendlyDate(booking.optString("date")) + " · " + booking.optString("pickupWindow"));
        details(card, "Адрес", booking.optString("address"));
        if (!booking.isNull("price") && booking.optBoolean("termsVerified")) details(card, "Стоимость", money(booking, "price"));
        if (!"created".equals(booking.optString("status"))) return;
        button(card, "Отметить выдачу", true, () -> confirmStatus(booking, "issued"));
        button(card, "Покупатель не пришёл", false, () -> confirmStatus(booking, "no_show"));
        if (!"seller".equals(userRole)) button(card, "Отменить бронь", false, () -> confirmStatus(booking, "cancelled"));
    }

    private void confirmStatus(JSONObject booking, String status) {
        new AlertDialog.Builder(this).setTitle(status.equals("issued") ? "Заказ действительно передан?" : status.equals("no_show") ? "Отметить, что покупатель не пришёл?" : "Отменить эту бронь?")
            .setMessage(booking.optString("code") + " · " + booking.optString("offerTitle"))
            .setNegativeButton("Не менять", null).setPositiveButton("Подтвердить", (dialog, which) -> mutate(() -> api.request("PATCH", "/api/partner/bookings/" + booking.getString("id") + "/status", json("status", status), true), value -> {
                message("Статус сохранён"); showCodes();
            }, null)).show();
    }

    private void showAccount() {
        if (!partnerGuard()) return;
        screen("Мой кабинет", this::showAccount, false);
        text(column, switch (userRole) { case "owner" -> "Владелец заведения"; case "manager" -> "Менеджер заведения"; default -> "Продавец заведения"; }, 20, INK);
        LinearLayout summary = card(column);
        text(summary, "Сегодня", 21, INK).setTypeface(null, Typeface.BOLD);
        TextView loading = text(summary, "Загружаем…", 16, MUTED);
        run(() -> api.request("GET", "/api/partner/dashboard?period=today", null, true), value -> {
            JSONObject data = (JSONObject) value;
            summary.removeView(loading);
            details(summary, "Брони", String.valueOf(data.optInt("bookingsCount")));
            details(summary, "Выдано", String.valueOf(data.optInt("issuedBookingsCount")));
            details(summary, "Выручка по выданным заказам", money(data, "estimatedRevenue"));
        }, null);
        if (!"seller".equals(userRole)) button(column, "Точки выдачи", false, () -> showAddresses(true));
        if (!"seller".equals(userRole)) button(column, "Профиль заведения", false, () -> showProfile(true));
        button(column, "Как работать", false, () -> showHelp(true));
        button(column, "Изменить пароль", false, () -> showChangePassword(true));
        button(column, "Перейти к покупкам", false, () -> { partnerMode = false; tab("offers"); });
        button(column, "Выйти из кабинета", false, () -> new AlertDialog.Builder(this).setTitle("Выйти из кабинета?").setNegativeButton("Остаться", null)
            .setPositiveButton("Выйти", (dialog, which) -> mutate(() -> {
                try { api.request("POST", "/api/partner/auth/logout", new JSONObject(), true); }
                catch (java.io.IOException error) { /* Local exit must also work offline. Server session expires separately. */ }
                catch (ApiClient.Failure error) { /* A revoked or unreachable server must not keep the local cabinet open. */ }
                finally { api.forgetSession(); }
                return new JSONObject();
            }, value -> { clearPartnerState(); partnerMode = false; tab("partner"); }, null)).show());
    }

    private void showAddresses(boolean child) {
        if (!partnerGuard()) return;
        screen("Точки выдачи", () -> showAddresses(false), child);
        if ("owner".equals(userRole)) button(column, "Добавить точку", true, () -> showAddressForm(true));
        run(() -> api.request("GET", "/api/partner/addresses", null, true), value -> {
            JSONArray addresses = (JSONArray) value;
            for (int i = 0; i < addresses.length(); i++) {
                JSONObject address = addresses.getJSONObject(i); LinearLayout card = card(column); text(card, address.optString("title"), 21, INK); text(card, address.optString("city") + " · " + address.optString("address"), 17, MUTED); text(card, address.optBoolean("is_active", true) ? "Работает" : "Закрыта", 15, TEAL);
                if ("owner".equals(userRole)) button(card, "Изменить точку", false, () -> showAddressForm(address, true));
            }
        }, null);
    }

    private void showAddressForm(boolean child) {
        showAddressForm(null, child);
    }
    private void showAddressForm(JSONObject existing, boolean child) {
        if (!"owner".equals(userRole)) { message("Точки выдачи добавляет владелец"); return; }
        screen(existing == null ? "Новая точка выдачи" : "Точка выдачи", () -> showAddressForm(existing, false), child);
        EditText title = field(column, "Название точки", existing == null ? "" : existing.optString("title"), InputType.TYPE_CLASS_TEXT, 120);
        EditText city = field(column, "Город", existing == null ? "Армавир" : existing.optString("city"), InputType.TYPE_CLASS_TEXT, 80);
        EditText address = field(column, "Адрес", existing == null ? "" : existing.optString("address"), InputType.TYPE_CLASS_TEXT, 160);
        CheckBox active = check(column, "Точка работает и выдаёт заказы"); active.setChecked(existing == null || existing.optBoolean("is_active", true));
        text(column, "Адрес уже оформленной брони не изменится. Перед закрытием точки проверьте текущие заказы.", 15, MUTED);
        Button submit = new Button(this); styleButton(submit, "Сохранить точку", true); addSpace(column, submit);
        submit.setOnClickListener(view -> mutate(() -> api.request(existing == null ? "POST" : "PATCH", "/api/partner/addresses" + (existing == null ? "" : "/" + existing.getString("id")), json("title", title.getText().toString(), "city", city.getText().toString(), "address", address.getText().toString(), "isActive", active.isChecked()), true), value -> { backStack.clear(); showAddresses(false); }, submit));
    }

    private void showProfile(boolean child) {
        if (!partnerGuard() || "seller".equals(userRole)) return;
        screen("Профиль заведения", () -> showProfile(false), child);
        run(() -> api.request("GET", "/api/partner/profile", null, true), value -> {
            JSONObject profile = (JSONObject) value;
            if (!"owner".equals(userRole)) {
                details(column, "Название", profile.optString("name")); details(column, "Контакт", profile.optString("contact_name")); details(column, "Телефон", profile.optString("phone")); details(column, "Email", profile.optString("email"));
                text(column, "Эти данные меняет владелец заведения.", 16, MUTED); return;
            }
            EditText name = field(column, "Название заведения", profile.optString("name"), InputType.TYPE_CLASS_TEXT, 120);
            EditText contact = field(column, "Контактное лицо", profile.optString("contact_name"), InputType.TYPE_CLASS_TEXT, 80);
            EditText phone = phoneField(column, "Телефон — по желанию", profile.optString("phone"));
            EditText email = field(column, "Email — по желанию", profile.optString("email"), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS, 120);
            Button save = button(column, "Сохранить данные", true, () -> { });
            save.setOnClickListener(view -> {
                try {
                    JSONObject data = json("name", name.getText().toString(), "contactName", contact.getText().toString(), "phone", phone.getText().toString().isEmpty() ? "" : AppRules.phone(phone.getText().toString()), "email", email.getText().toString());
                    mutate(() -> api.request("PATCH", "/api/partner/profile", data, true), result -> { message("Данные сохранены"); showProfile(false); }, save);
                } catch (IllegalArgumentException error) { message(error.getMessage()); }
            });
        }, null);
    }

    private void showHelp(boolean child) {
        screen("Как работать", () -> showHelp(false), child);
        if (!"seller".equals(userRole)) {
            LinearLayout offer = card(column); text(offer, "Разместить предложение", 22, INK);
            text(offer, "Откройте «Предложения» → «Добавить предложение». Выберите точку, добавьте своё фото, состав, цену, количество и время. Проверьте карточку и опубликуйте.", 17, MUTED);
        }
        LinearLayout code = card(column); text(code, "Выдать заказ", 22, INK);
        text(code, "Попросите покупателя показать код. Откройте «Коды» и найдите бронь. Проверьте набор и время. Покупатель оплачивает в магазине. Передайте заказ и нажмите «Отметить выдачу».", 17, MUTED);
        LinearLayout connection = card(column); text(connection, "Если пропал интернет", 22, INK);
        text(connection, "Не отмечайте выдачу наугад и не публикуйте второй экземпляр. Восстановите связь, обновите список и проверьте, сохранилось ли действие. За помощью с доступом обратитесь к администратору проекта.", 17, MUTED);
    }

    private void showChangePassword(boolean child) {
        screen("Новый пароль", () -> showChangePassword(false), child);
        text(column, passwordChangeRequired ? "Перед началом работы замените временный пароль на свой." : "Пароль изменится и для входа на сайте.", 17, MUTED);
        EditText old = passwordField(column, "Текущий пароль");
        EditText next = passwordField(column, "Новый пароль — от 12 символов");
        EditText confirm = passwordField(column, "Повторите новый пароль");
        Button submit = new Button(this); styleButton(submit, "Сохранить новый пароль", true); addSpace(column, submit);
        submit.setOnClickListener(view -> {
            String value = next.getText().toString();
            if (value.length() < 12 || !value.equals(confirm.getText().toString())) { message("Нужно не менее 12 символов. Пароли должны совпадать."); return; }
            mutate(() -> api.request("POST", "/api/partner/auth/change-password", json("currentPassword", old.getText().toString(), "newPassword", value, "confirmPassword", confirm.getText().toString()), true), result -> {
                old.setText(""); next.setText(""); confirm.setText(""); passwordChangeRequired = false; message("Пароль изменён"); enterPartner();
            }, submit);
        });
    }

    void run(Job job, Result result, Button button) {
        runTask(job, result, button, false);
    }
    void mutate(Job job, Result result, Button button) {
        if (mutationInFlight) { message("Подождите, сохраняем изменения…"); return; }
        mutationInFlight = true; progress.setVisibility(View.VISIBLE); runTask(job, result, button, true);
    }
    private void runTask(Job job, Result result, Button button, boolean mutation) {
        int expected = generation; if (button != null) button.setEnabled(false);
        worker.execute(() -> {
            try { Object value = job.run(); runOnUiThread(() -> {
                if (mutation) { mutationInFlight = false; progress.setVisibility(View.GONE); }
                if (isFinishing() || isDestroyed()) return;
                if (button != null) button.setEnabled(true);
                if (expected != generation) return;
                try { result.receive(value); } catch (Exception error) { showError(error); }
            }); } catch (Exception error) { runOnUiThread(() -> {
                if (mutation) { mutationInFlight = false; progress.setVisibility(View.GONE); }
                if (isFinishing() || isDestroyed()) return;
                if (button != null) button.setEnabled(true);
                if (expected != generation) return;
                showError(error);
            }); }
        });
    }

    private void showError(Exception error) {
        if (error instanceof ApiClient.Failure failure) {
            if (failure.status == 401 && adminMode) { adminMode = false; backStack.clear(); admin.login(false); message("Войдите как администратор ещё раз"); return; }
            if (failure.status == 401 && partnerMode) { clearPartnerState(); partnerMode = false; selectedTab = "partner"; backStack.clear(); showLogin(false); message("Войдите в кабинет ещё раз"); return; }
            if ("PASSWORD_CHANGE_REQUIRED".equals(failure.code)) { if (adminMode) { adminPasswordChangeRequired = true; admin.password(false); } else { passwordChangeRequired = true; showChangePassword(false); } return; }
            text(column, failure.getMessage(), 17, INK);
        } else if (error instanceof IllegalArgumentException) text(column, error.getMessage(), 17, INK);
        else text(column, publicationUncertain
            ? "Ответ не пришёл. Предложение могло сохраниться. Откройте «Предложения» и проверьте список."
            : pendingBooking != null
                ? "Ответ не пришёл. Бронь могла оформиться. Откройте «Предложения» и нажмите «Проверить бронь»."
                : "Нет ответа от сервиса. Проверьте интернет и попробуйте ещё раз.", 17, INK);
        Runnable retry = currentScreen;
        if (retry != null) button(column, "Повторить", false, retry);
    }

    // An expired/revoked account must not leave its business draft in memory for the next user.
    private void clearPartnerState() {
        userRole = ""; passwordChangeRequired = false; publicationUncertain = false;
        offerDraft = new JSONObject(); editingOffer = "";
        store.remove("offer-draft"); store.remove("publication-uncertain");
    }

    private void picture(LinearLayout parent, String path, String description) {
        if (!AppRules.trustedImage(path)) return;
        ImageView view = new ImageView(this); view.setScaleType(ImageView.ScaleType.CENTER_CROP); view.setContentDescription(description);
        view.setBackground(shape(0xffe5ece7, 14, 0)); view.setClipToOutline(true); addSpace(parent, view, dp(190));
        int expected = generation;
        images.execute(() -> { try { Bitmap bitmap = api.image(path); runOnUiThread(() -> { if (generation == expected && !isDestroyed() && bitmap != null) view.setImageBitmap(bitmap); else if (bitmap != null) bitmap.recycle(); }); } catch (Exception ignored) { /* Text remains usable if a photo cannot load. */ } });
    }

    EditText field(LinearLayout parent, String label, String initial, int type, int max) {
        text(parent, label, 15, INK).setPadding(0, dp(10), 0, dp(4));
        EditText input = new EditText(this); input.setTextSize(17); input.setTextColor(INK); input.setInputType(type); input.setText(initial); input.setSaveEnabled(false);
        input.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(max)}); input.setBackground(shape(Color.WHITE, 12, 0xffccd8d6));
        input.setPadding(dp(13), dp(13), dp(13), dp(13)); input.setMinHeight(dp(52)); input.setContentDescription(label); addSpace(parent, input); return input;
    }
    EditText phoneField(LinearLayout parent, String label, String initial) {
        text(parent, label, 15, INK).setPadding(0, dp(10), 0, dp(4));
        LinearLayout row = horizontal(); row.setGravity(Gravity.CENTER_VERTICAL); row.setBackground(shape(Color.WHITE, 12, 0xffccd8d6));
        TextView prefix = text(row, "+7", 18, INK); prefix.setPadding(dp(14), 0, dp(8), 0); prefix.setContentDescription("Код страны +7");
        prefix.setLayoutParams(new LinearLayout.LayoutParams(-2, -2));
        EditText input = new EditText(this); input.setTextSize(18); input.setTextColor(INK); input.setInputType(InputType.TYPE_CLASS_PHONE); input.setBackgroundColor(Color.TRANSPARENT);
        input.setPadding(dp(4), dp(13), dp(13), dp(13)); input.setContentDescription(label + ": десять цифр после +7"); input.setSaveEnabled(false); input.setText(AppRules.phoneDigits(initial));
        input.addTextChangedListener(new TextWatcher() {
            boolean changing;
            public void beforeTextChanged(CharSequence value, int start, int count, int after) { }
            public void onTextChanged(CharSequence value, int start, int before, int count) { }
            public void afterTextChanged(Editable value) {
                if (changing) return;
                String normalized = AppRules.phoneDigits(value.toString());
                if (!normalized.equals(value.toString())) { changing = true; input.setText(normalized); input.setSelection(normalized.length()); changing = false; }
            }
        });
        row.addView(input, new LinearLayout.LayoutParams(0, dp(54), 1)); addSpace(parent, row);
        return input;
    }
    EditText passwordField(LinearLayout parent, String label) {
        EditText input = field(parent, label, "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD, 120);
        input.setAutofillHints(View.AUTOFILL_HINT_PASSWORD); input.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_YES);
        parent.removeView(input); input.setBackgroundColor(Color.TRANSPARENT);
        LinearLayout row = horizontal(); row.setGravity(Gravity.CENTER_VERTICAL); row.setBackground(shape(Color.WHITE, 12, 0xffccd8d6));
        row.addView(input, new LinearLayout.LayoutParams(0, -2, 1));
        android.widget.ImageButton toggle = new android.widget.ImageButton(this);
        toggle.setImageResource(R.drawable.ic_eye); toggle.setContentDescription("Показать пароль"); toggle.setBackground(shape(0xffe9f1ed, 12, 0)); toggle.setPadding(dp(12), dp(12), dp(12), dp(12));
        row.addView(toggle, new LinearLayout.LayoutParams(dp(48), dp(52))); addSpace(parent, row);
        toggle.setOnClickListener(view -> {
            boolean hidden = input.getTransformationMethod() instanceof android.text.method.PasswordTransformationMethod;
            input.setTransformationMethod(hidden ? null : android.text.method.PasswordTransformationMethod.getInstance());
            toggle.setImageResource(hidden ? R.drawable.ic_eye_off : R.drawable.ic_eye);
            toggle.setContentDescription(hidden ? "Скрыть пароль" : "Показать пароль"); input.setSelection(input.getText().length());
        });
        return input;
    }
    Spinner choices(LinearLayout parent, String[] values, int selected) {
        Spinner spinner = new Spinner(this); ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, values);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item); spinner.setAdapter(adapter); spinner.setSelection(selected); spinner.setBackground(shape(Color.WHITE, 12, 0xffccd8d6)); spinner.setPadding(dp(10), dp(10), dp(10), dp(10)); addSpace(parent, spinner, dp(52)); return spinner;
    }
    private CheckBox check(LinearLayout parent, String label) { CheckBox check = new CheckBox(this); check.setText(label); check.setTextSize(15); check.setTextColor(INK); check.setButtonTintList(ColorStateList.valueOf(TEAL)); check.setPadding(0, dp(10), 0, dp(10)); addSpace(parent, check); return check; }
    private void legalLinks(LinearLayout parent, boolean partner) {
        button(parent, "Политика конфиденциальности", false, () -> openDocument("/privacy"));
        button(parent, "Согласие на обработку данных", false, () -> openDocument("/personal-data-consent"));
        if (partner) button(parent, "Условия подключения", false, () -> openDocument("/partner-terms"));
    }
    private void openDocument(String path) { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(AppRules.ORIGIN + path))); }
    LinearLayout vertical() { LinearLayout layout = new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL); return layout; }
    private LinearLayout horizontal() { LinearLayout layout = new LinearLayout(this); layout.setOrientation(LinearLayout.HORIZONTAL); return layout; }
    TextView text(LinearLayout parent, String value, int size, int color) { TextView text = new TextView(this); text.setText(value); text.setTextSize(size); text.setTextColor(color); text.setLineSpacing(dp(3), 1); text.setPadding(0, dp(4), 0, dp(4)); parent.addView(text, new LinearLayout.LayoutParams(-1, -2)); return text; }
    void details(LinearLayout parent, String label, String value) { if (value == null || value.isEmpty()) return; text(parent, label, 14, MUTED).setPadding(0, dp(12), 0, 0); text(parent, value, 17, INK); }
    LinearLayout card(LinearLayout parent) { LinearLayout card = vertical(); card.setPadding(dp(16), dp(14), dp(16), dp(14)); card.setBackground(shape(Color.WHITE, 18, 0xffe0e8e3)); addSpace(parent, card); return card; }
    Button button(LinearLayout parent, String label, boolean primary, Runnable action) { Button button = new Button(this); styleButton(button, label, primary); button.setOnClickListener(view -> { if (mutationInFlight) message("Подождите, сохраняем изменения…"); else action.run(); }); addSpace(parent, button); return button; }
    private void styleButton(Button button, String label, boolean primary) { button.setText(label); button.setAllCaps(false); button.setTextSize(16); button.setTypeface(null, Typeface.BOLD); button.setTextColor(primary ? Color.WHITE : TEAL); button.setBackground(shape(primary ? ORANGE : 0xffe9f1ed, 13, 0)); button.setPadding(dp(12), dp(10), dp(12), dp(10)); button.setMinHeight(dp(52)); }
    private void addSpace(LinearLayout parent, View view) { addSpace(parent, view, -2); }
    private void addSpace(LinearLayout parent, View view, int height) { LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, height); params.topMargin = dp(10); parent.addView(view, params); }
    private GradientDrawable shape(int fill, int radius, int border) { GradientDrawable shape = new GradientDrawable(); shape.setColor(fill); shape.setCornerRadius(dp(radius)); if (border != 0) shape.setStroke(dp(1), border); return shape; }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    String money(JSONObject value, String key) { if (value.isNull(key)) return "Стоимость не указана"; return new java.text.DecimalFormat("0.##").format(value.optDouble(key)) + " ₽"; }
    void message(String text) { Toast.makeText(this, text == null ? "Проверьте заполненные поля" : text, Toast.LENGTH_LONG).show(); }
    private void hideKeyboard() { View view = getCurrentFocus(); if (view != null) ((InputMethodManager) getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(view.getWindowToken(), 0); }
    private TextWatcher watcher(Runnable action) { return new TextWatcher() { public void beforeTextChanged(CharSequence value, int start, int count, int after) { } public void onTextChanged(CharSequence value, int start, int before, int count) { } public void afterTextChanged(Editable value) { action.run(); } }; }
    private android.widget.AdapterView.OnItemSelectedListener selection(java.util.function.IntConsumer action) { return new android.widget.AdapterView.OnItemSelectedListener() { public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) { action.accept(position); } public void onNothingSelected(android.widget.AdapterView<?> parent) { } }; }
    JSONObject json(Object... items) { JSONObject object = new JSONObject(); try { for (int i = 0; i < items.length; i += 2) object.put((String) items[i], items[i + 1]); } catch (Exception error) { throw new IllegalArgumentException("Не удалось подготовить данные", error); } return object; }
    void openAdminTab(String key) { partnerMode = false; adminMode = true; tab(key); }
    void exitAdmin() { adminMode = false; partnerMode = false; backStack.clear(); tab("partner"); }
    @Override protected void onSaveInstanceState(Bundle state) { state.putBoolean("partnerMode", partnerMode); state.putBoolean("adminMode", adminMode); state.putString("visitorTab", partnerMode || adminMode ? "offers" : selectedTab); super.onSaveInstanceState(state); }
    @Override protected void onDestroy() { worker.shutdown(); images.shutdown(); super.onDestroy(); }
}
