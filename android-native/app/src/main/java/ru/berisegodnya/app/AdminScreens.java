package ru.berisegodnya.app;

import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Typeface;
import android.net.Uri;
import android.text.InputType;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;
import org.json.JSONArray;
import org.json.JSONObject;

/** Mobile administrator workspace, separate from partner session and never a desktop web page. */
final class AdminScreens {
    private static final int INK = 0xff102f38, MUTED = 0xff667b7e, TEAL = 0xff0b646a;
    private static final String[] TYPES = {"bakery", "culinary", "buffet", "coffee", "ready_food_cafe", "other"};
    private static final String[] TYPE_NAMES = {"Пекарня", "Кулинария", "Буфет", "Кофейня", "Кафе готовой еды", "Другое"};
    private final MainActivity app;
    AdminScreens(MainActivity app) { this.app = app; }

    void login(boolean child) {
        if (app.api.hasAdminSession()) { enter(); return; }
        app.screen("Вход администратора", () -> login(false), child);
        note("Этот раздел только для управления проектом. У заведений свой вход партнёра.");
        EditText login = app.field(app.column, "Логин администратора", "", InputType.TYPE_CLASS_TEXT, 120);
        EditText password = app.passwordField(app.column, "Пароль");
        Button submit = app.button(app.column, "Войти", true, () -> { });
        submit.setOnClickListener(view -> {
            String user = login.getText().toString().trim(), pass = password.getText().toString();
            if (user.isEmpty() || pass.isEmpty()) { app.message("Введите логин и пароль"); return; }
            app.mutate(() -> app.api.request("POST", "/api/admin/auth/login", app.json("login", user, "password", pass), false), value -> {
                password.setText(""); app.adminPasswordChangeRequired = ((JSONObject) value).optBoolean("passwordChangeRequired"); enter();
            }, submit);
        });
    }
    private void enter() {
        app.run(() -> app.api.request("GET", "/api/admin/auth/me", null, true), value -> {
            JSONObject auth = (JSONObject) value;
            if (!auth.optBoolean("authenticated")) { app.api.forgetAdminSession(); login(false); return; }
            app.adminPasswordChangeRequired = auth.optBoolean("passwordChangeRequired");
            if (app.adminPasswordChangeRequired) { app.adminMode = true; password(false); }
            else app.openAdminTab("admin-overview");
        }, null);
    }
    private boolean guard() {
        if (!app.api.hasAdminSession()) { app.adminMode = false; login(false); return false; }
        if (app.adminPasswordChangeRequired) { password(false); return false; }
        return true;
    }
    void overview(boolean child) {
        if (!guard()) return;
        app.screen("Как идут дела", () -> overview(false), child);
        app.run(() -> app.api.request("GET", "/api/admin/dashboard", null, true), value -> {
            JSONObject data = (JSONObject) value; LinearLayout summary = app.card(app.column);
            app.details(summary, "Предложений на витрине", String.valueOf(data.optInt("activeOffersCount")));
            app.details(summary, "Всего броней", String.valueOf(data.optInt("bookingsCount")));
            app.details(summary, "Заказов выдано", String.valueOf(data.optInt("issuedBookingsCount")));
            app.details(summary, "Выручка заведений по выданным заказам", app.money(data, "estimatedPartnerRevenue"));
            if (data.optInt("unknownIssuedAmountsCount") > 0) app.text(summary, "Некоторые старые заказы без подтверждённой цены не включены в сумму.", 14, MUTED);
            app.button(app.column, "Новые заявки: " + data.optInt("newPartnerApplicationsCount"), true, () -> applications(true));
            app.button(app.column, "Обращения: " + data.optInt("newContactRequestsCount"), false, () -> contacts(true));
            app.button(app.column, "Подключить заведение", false, () -> onboard(null, true));
            app.button(app.column, "Обновить", false, () -> overview(false));
        }, null);
    }
    void partners(boolean child) {
        if (!guard()) return;
        app.screen("Заведения", () -> partners(false), child);
        app.button(app.column, "Подключить заведение", true, () -> onboard(null, true));
        EditText search = app.field(app.column, "Поиск по названию", "", InputType.TYPE_CLASS_TEXT, 120);
        LinearLayout list = app.vertical(); app.column.addView(list);
        app.run(() -> app.api.request("GET", "/api/admin/partners", null, true), value -> {
            JSONArray partners = (JSONArray) value;
            Runnable render = () -> {
                list.removeAllViews(); String query = search.getText().toString().trim().toLowerCase(java.util.Locale.ROOT);
                for (int i = partners.length() - 1; i >= 0; i--) {
                    JSONObject partner = partners.optJSONObject(i);
                    if (partner == null || !partner.optString("name").toLowerCase(java.util.Locale.ROOT).contains(query)) continue;
                    LinearLayout row = app.card(list); title(row, partner.optString("name"));
                    app.text(row, partnerStatus(partner.optString("status")), 16, TEAL);
                    app.text(row, partner.optString("contact_name") + " · " + partner.optString("phone"), 16, MUTED);
                    app.button(row, "Открыть заведение", false, () -> partner(partner, true));
                }
            };
            render.run(); search.addTextChangedListener(new android.text.TextWatcher() { public void beforeTextChanged(CharSequence s, int start, int count, int after) { } public void onTextChanged(CharSequence s, int start, int before, int count) { render.run(); } public void afterTextChanged(android.text.Editable s) { } });
        }, null);
    }
    private void partner(JSONObject partner, boolean child) {
        app.screen(partner.optString("name"), () -> partner(partner, false), child);
        note(partnerStatus(partner.optString("status")));
        app.details(app.column, "Контакт", partner.optString("contact_name")); app.details(app.column, "Телефон", partner.optString("phone")); app.details(app.column, "Email", partner.optString("email"));
        String id = partner.optString("id");
        app.button(app.column, "Изменить данные", true, () -> editPartner(partner, true));
        app.button(app.column, "Сотрудники и доступы", false, () -> users(id, true));
        app.button(app.column, "Точки выдачи", false, () -> addresses(id, true));
        app.button(app.column, "Предложения заведения", false, () -> offers(id, true));
        boolean active = "active".equals(partner.optString("status"));
        app.button(app.column, active ? "Приостановить работу" : "Возобновить работу", false, () -> confirm(active ? "Приостановить заведение?" : "Возобновить заведение?", "Брони и история не удалятся.", () -> app.mutate(() -> app.api.request("PATCH", "/api/admin/partners/" + id, app.json("status", active ? "paused" : "active"), true), value -> partner((JSONObject) value, false), null)));
    }
    private void editPartner(JSONObject partner, boolean child) {
        app.screen("Данные заведения", () -> editPartner(partner, false), child);
        EditText name = app.field(app.column, "Название", partner.optString("name"), InputType.TYPE_CLASS_TEXT, 120);
        EditText contact = app.field(app.column, "Контактное лицо", partner.optString("contact_name"), InputType.TYPE_CLASS_TEXT, 80);
        EditText phone = app.phoneField(app.column, "Телефон", partner.optString("phone"));
        EditText email = app.field(app.column, "Email", partner.optString("email"), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS, 120);
        Button save = app.button(app.column, "Сохранить", true, () -> { });
        save.setOnClickListener(view -> {
            try { JSONObject data = app.json("name", name.getText().toString(), "contactName", contact.getText().toString(), "phone", phone.getText().toString().isEmpty() ? "" : AppRules.phone(phone.getText().toString()), "email", email.getText().toString());
                app.mutate(() -> app.api.request("PATCH", "/api/admin/partners/" + partner.getString("id"), data, true), value -> { app.message("Данные сохранены"); partner((JSONObject) value, false); }, save);
            } catch (Exception error) { app.message(error.getMessage()); }
        });
    }
    private void onboard(JSONObject application, boolean child) {
        app.screen("Подключить заведение", () -> onboard(application, false), child);
        note("Создадим заведение, первую точку и вход владельца. При первом входе владелец задаст свой пароль.");
        EditText name = app.field(app.column, "Название заведения", application == null ? "" : application.optString("venue_name"), InputType.TYPE_CLASS_TEXT, 120);
        app.text(app.column, "Тип заведения", 15, INK); Spinner type = app.choices(app.column, TYPE_NAMES, 0);
        EditText contact = app.field(app.column, "Контактное лицо", application == null ? "" : application.optString("contact_name"), InputType.TYPE_CLASS_TEXT, 80);
        EditText phone = app.phoneField(app.column, "Телефон", application == null ? "" : application.optString("phone"));
        EditText email = app.field(app.column, "Email", application == null ? "" : application.optString("email"), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS, 120);
        EditText city = app.field(app.column, "Город", application == null ? "Армавир" : application.optString("city", "Армавир"), InputType.TYPE_CLASS_TEXT, 80);
        EditText address = app.field(app.column, "Адрес выдачи", application == null ? "" : application.optString("first_address"), InputType.TYPE_CLASS_TEXT, 160);
        EditText login = app.field(app.column, "Логин владельца", "", InputType.TYPE_CLASS_TEXT, 80);
        EditText password = app.passwordField(app.column, "Временный пароль — от 12 символов");
        Button save = app.button(app.column, "Подключить заведение", true, () -> { });
        save.setOnClickListener(view -> {
            try {
                if (password.getText().length() < 12) throw new IllegalArgumentException("Придумайте временный пароль не короче 12 символов");
                JSONObject data = app.json("partnerName", name.getText().toString(), "partnerType", TYPES[type.getSelectedItemPosition()], "contactName", contact.getText().toString(), "userName", contact.getText().toString(), "phone", phone.getText().toString().isEmpty() ? "" : AppRules.phone(phone.getText().toString()), "email", email.getText().toString(), "city", city.getText().toString(), "address", address.getText().toString(), "addressTitle", "Основная точка", "login", login.getText().toString(), "password", password.getText().toString());
                if (application != null) data.put("applicationId", application.getString("id"));
                confirm("Подключить это заведение?", name.getText().toString() + "\n" + address.getText().toString(), () -> app.mutate(() -> app.api.request("POST", "/api/admin/partners/onboard", data, true), value -> {
                    password.setText(""); app.message("Заведение подключено. Передайте владельцу логин и временный пароль."); app.openAdminTab("admin-partners");
                }, save));
            } catch (Exception error) { app.message(error.getMessage()); }
        });
    }
    private void users(String partnerId, boolean child) {
        app.screen("Сотрудники и доступы", () -> users(partnerId, false), child);
        app.button(app.column, "Добавить сотрудника", true, () -> userForm(partnerId, null, true));
        app.run(() -> app.api.request("GET", "/api/admin/partners/" + partnerId + "/users", null, true), value -> {
            JSONArray users = (JSONArray) value;
            for (int i = 0; i < users.length(); i++) {
                JSONObject user = users.getJSONObject(i); LinearLayout card = app.card(app.column); title(card, user.optString("name"));
                app.details(card, "Логин", user.optString("login")); app.text(card, roleName(user.optString("role")) + " · " + ("active".equals(user.optString("status")) ? "Вход открыт" : "Вход закрыт"), 16, TEAL);
                app.button(card, "Изменить доступ или пароль", false, () -> userForm(partnerId, user, true));
                boolean active = "active".equals(user.optString("status"));
                app.button(card, active ? "Закрыть доступ" : "Открыть доступ", false, () -> confirm(active ? "Закрыть вход этому сотруднику?" : "Открыть вход этому сотруднику?", user.optString("name"), () -> app.mutate(() -> app.api.request("PATCH", "/api/admin/partners/" + partnerId + "/users/" + user.getString("id"), app.json("status", active ? "disabled" : "active"), true), result -> users(partnerId, false), null)));
            }
        }, null);
    }
    private void userForm(String partnerId, JSONObject user, boolean child) {
        app.screen(user == null ? "Новый сотрудник" : "Доступ сотрудника", () -> userForm(partnerId, user, false), child);
        EditText name = app.field(app.column, "Имя", user == null ? "" : user.optString("name"), InputType.TYPE_CLASS_TEXT, 120);
        EditText login = app.field(app.column, "Логин", user == null ? "" : user.optString("login"), InputType.TYPE_CLASS_TEXT, 80);
        String[] roles = {"owner", "manager", "seller"}; int selected = user == null ? 2 : user.optString("role").equals("owner") ? 0 : user.optString("role").equals("manager") ? 1 : 2;
        app.text(app.column, "Что сотрудник может делать", 15, INK); Spinner role = app.choices(app.column, new String[]{"Владелец", "Менеджер", "Продавец — только выдача"}, selected);
        EditText password = app.passwordField(app.column, user == null ? "Временный пароль — от 12 символов" : "Новый временный пароль — оставьте пустым, если не меняете");
        Button save = app.button(app.column, "Сохранить доступ", true, () -> { });
        save.setOnClickListener(view -> {
            try {
                JSONObject data = app.json("name", name.getText().toString(), "login", login.getText().toString(), "role", roles[role.getSelectedItemPosition()]);
                String pass = password.getText().toString();
                if (user == null || !pass.isEmpty()) { if (pass.length() < 12) throw new IllegalArgumentException("Нужно не менее 12 символов в пароле"); data.put("password", pass); }
                app.mutate(() -> app.api.request(user == null ? "POST" : "PATCH", "/api/admin/partners/" + partnerId + "/users" + (user == null ? "" : "/" + user.getString("id")), data, true), result -> { password.setText(""); app.message("Доступ сохранён"); users(partnerId, false); }, save);
            } catch (Exception error) { app.message(error.getMessage()); }
        });
    }
    private void addresses(String partnerId, boolean child) {
        app.screen("Точки выдачи", () -> addresses(partnerId, false), child);
        app.button(app.column, "Добавить точку", true, () -> addressForm(partnerId, null, true));
        app.run(() -> app.api.request("GET", "/api/admin/partners/" + partnerId + "/addresses", null, true), value -> {
            JSONArray addresses = (JSONArray) value;
            for (int i = 0; i < addresses.length(); i++) {
                JSONObject address = addresses.getJSONObject(i); LinearLayout card = app.card(app.column); title(card, address.optString("title"));
                app.text(card, address.optString("city") + " · " + address.optString("address"), 17, MUTED);
                boolean active = address.optBoolean("is_active", true); app.text(card, active ? "Работает" : "Закрыта", 15, TEAL);
                app.button(card, "Изменить адрес", false, () -> addressForm(partnerId, address, true));
                app.button(card, active ? "Закрыть точку" : "Открыть точку", false, () -> confirm(active ? "Закрыть эту точку?" : "Открыть эту точку?", "Существующие брони и их адреса сохранятся.", () -> app.mutate(() -> app.api.request("PATCH", "/api/admin/partners/" + partnerId + "/addresses/" + address.getString("id"), app.json("isActive", !active), true), result -> addresses(partnerId, false), null)));
            }
        }, null);
    }
    private void addressForm(String partnerId, JSONObject address, boolean child) {
        app.screen(address == null ? "Новая точка" : "Адрес выдачи", () -> addressForm(partnerId, address, false), child);
        EditText title = app.field(app.column, "Название точки", address == null ? "" : address.optString("title"), InputType.TYPE_CLASS_TEXT, 120);
        EditText city = app.field(app.column, "Город", address == null ? "Армавир" : address.optString("city"), InputType.TYPE_CLASS_TEXT, 80);
        EditText line = app.field(app.column, "Адрес", address == null ? "" : address.optString("address"), InputType.TYPE_CLASS_TEXT, 160);
        Button save = app.button(app.column, "Сохранить адрес", true, () -> { });
        save.setOnClickListener(view -> app.mutate(() -> app.api.request(address == null ? "POST" : "PATCH", "/api/admin/partners/" + partnerId + "/addresses" + (address == null ? "" : "/" + address.getString("id")), app.json("title", title.getText().toString(), "city", city.getText().toString(), "address", line.getText().toString()), true), value -> addresses(partnerId, false), save));
    }
    private void offers(String partnerId, boolean child) {
        app.screen("Предложения", () -> offers(partnerId, false), child);
        app.run(() -> app.api.request("GET", "/api/admin/offers", null, true), value -> {
            JSONArray offers = (JSONArray) value;
            for (int i = offers.length() - 1; i >= 0; i--) {
                JSONObject offer = offers.getJSONObject(i); if (!partnerId.isEmpty() && !partnerId.equals(offer.optString("partner_id"))) continue;
                LinearLayout card = app.card(app.column); title(card, offer.optString("title"));
                app.text(card, AppRules.status(offer.optString("status")) + " · " + app.money(offer, "price"), 17, TEAL);
                app.text(card, AppRules.friendlyDate(offer.optString("date")) + " · " + offer.optString("pickup_window") + " · доступно: " + offer.optInt("remaining_quantity"), 16, MUTED);
                app.button(card, "Изменить предложение", false, () -> offerForm(offer, partnerId, true));
                boolean active = "active".equals(offer.optString("status"));
                app.button(card, active ? "Снять с витрины" : "Вернуть на витрину", false, () -> confirm(active ? "Снять предложение?" : "Опубликовать предложение?", "Ранее оформленные брони сохранятся.", () -> app.mutate(() -> app.api.request("PATCH", "/api/admin/offers/" + offer.getString("id"), app.json("status", active ? "paused" : "active"), true), result -> offers(partnerId, false), null)));
            }
        }, null);
    }
    private void offerForm(JSONObject offer, String partnerId, boolean child) {
        app.screen("Изменить предложение", () -> offerForm(offer, partnerId, false), child);
        note("Изменения относятся к новым броням. У уже оформленных заказов цена и условия сохраняются.");
        EditText title = app.field(app.column, "Название", offer.optString("title"), InputType.TYPE_CLASS_TEXT, 120);
        EditText contents = app.field(app.column, "Состав", offer.optString("contents"), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE, 500);
        EditText allergens = app.field(app.column, "Аллергены", offer.optString("allergens"), InputType.TYPE_CLASS_TEXT, 240);
        EditText price = app.field(app.column, "Цена, ₽", offer.optString("price"), InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL, 10);
        EditText oldPrice = app.field(app.column, "Обычная цена, ₽ — по желанию", offer.isNull("old_price") ? "" : offer.optString("old_price"), InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL, 10);
        Button save = app.button(app.column, "Сохранить", true, () -> { });
        save.setOnClickListener(view -> {
            try { double amount = Double.parseDouble(price.getText().toString().replace(',', '.'));
                String previousPrice = oldPrice.getText().toString().trim();
                double oldAmount = previousPrice.isEmpty() ? 0 : Double.parseDouble(previousPrice.replace(',', '.'));
                if (!Double.isFinite(amount) || !Double.isFinite(oldAmount) || amount < 1 || oldAmount < 0 || (oldAmount > 0 && oldAmount <= amount)) { app.message("Проверьте цены. Обычная цена должна быть выше цены предложения."); return; }
                app.mutate(() -> app.api.request("PATCH", "/api/admin/offers/" + offer.getString("id"), app.json("title", title.getText().toString(), "contents", contents.getText().toString(), "allergens", allergens.getText().toString(), "price", amount, "oldPrice", oldAmount == 0 ? "" : oldAmount), true), value -> offers(partnerId, false), save);
            } catch (NumberFormatException error) { app.message("Введите цену цифрами"); }
        });
    }
    void bookings(boolean child) {
        if (!guard()) return;
        app.screen("Брони покупателей", () -> bookings(false), child);
        EditText code = app.field(app.column, "Найти по коду — или оставьте пустым", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS, 12);
        LinearLayout list = app.vertical(); app.column.addView(list);
        Runnable load = () -> app.run(() -> app.api.request("GET", "/api/admin/bookings", null, true), value -> {
            list.removeAllViews(); JSONArray bookings = (JSONArray) value; String filter = code.getText().toString().replaceAll("\\s", "").toUpperCase(java.util.Locale.ROOT);
            for (int i = bookings.length() - 1; i >= 0; i--) {
                JSONObject booking = bookings.getJSONObject(i); if (!filter.isEmpty() && !filter.equals(booking.optString("code"))) continue;
                LinearLayout card = app.card(list); title(card, booking.optString("code") + " · " + booking.optString("offerTitle"));
                app.text(card, booking.optString("partnerName"), 16, MUTED); app.text(card, AppRules.status(booking.optString("status")), 17, TEAL);
                app.details(card, "Выдача", AppRules.friendlyDate(booking.optString("date")) + " · " + booking.optString("pickupWindow"));
                app.details(card, "Покупатель", booking.optString("customer_name")); app.details(card, "Телефон", booking.optString("customer_phone"));
                app.button(card, "Изменить статус", false, () -> bookingStatus(booking, true));
            }
            if (list.getChildCount() == 0) app.text(list, "Броней с таким кодом нет", 18, MUTED);
        }, null);
        app.button(app.column, "Показать брони", true, load); load.run();
    }
    private void bookingStatus(JSONObject booking, boolean child) {
        app.screen("Статус брони " + booking.optString("code"), () -> bookingStatus(booking, false), child);
        title(app.column, booking.optString("offerTitle")); note("Сейчас: " + AppRules.status(booking.optString("status")));
        String[] statuses = {"issued", "no_show", "cancelled"};
        Spinner status = app.choices(app.column, new String[]{"Заказ выдан", "Покупатель не пришёл", "Бронь отменена"}, 0);
        boolean correction = !"created".equals(booking.optString("status"));
        EditText reason = correction ? app.field(app.column, "Почему исправляете завершённую бронь?", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE, 500) : null;
        app.button(app.column, "Подтвердить изменение", true, () -> {
            if (correction && reason.getText().toString().trim().length() < 10) { app.message("Кратко опишите причину — не менее 10 символов"); return; }
            JSONObject data = app.json("status", statuses[status.getSelectedItemPosition()]);
            if (correction) { try { data.put("expectedStatus", booking.getString("status")); data.put("reason", reason.getText().toString()); } catch (Exception error) { app.message("Обновите бронь и попробуйте ещё раз"); return; } }
            confirm("Изменить статус этой брони?", booking.optString("code") + "\n" + AppRules.status(statuses[status.getSelectedItemPosition()]), () -> app.mutate(() -> app.api.request("PATCH", "/api/admin/bookings/" + booking.getString("id") + (correction ? "/correction" : "/status"), data, true), value -> { app.message("Статус сохранён"); app.openAdminTab("admin-bookings"); }, null));
        });
    }
    private void applications(boolean child) {
        app.screen("Заявки заведений", () -> applications(false), child);
        app.run(() -> app.api.request("GET", "/api/admin/partner-applications", null, true), value -> {
            JSONArray applications = (JSONArray) value;
            if (applications.length() == 0) note("Новых заявок пока нет");
            for (int i = applications.length() - 1; i >= 0; i--) {
                JSONObject item = applications.getJSONObject(i); LinearLayout card = app.card(app.column); title(card, item.optString("venue_name"));
                app.text(card, applicationStatus(item.optString("status")), 16, TEAL);
                app.details(card, "Контакт", item.optString("contact_name") + " · " + item.optString("phone"));
                app.details(card, "Адрес", item.optString("city") + " · " + item.optString("first_address")); app.details(card, "Комментарий", item.optString("comment"));
                dial(card, item.optString("phone"));
                if (item.optString("created_partner_id").isEmpty()) app.button(card, "Подключить по этой заявке", true, () -> onboard(item, true));
                app.button(card, "Изменить статус заявки", false, () -> selectStatus("Статус заявки", new String[]{"Новая", "Связались", "Отклонена", "В архиве"}, new String[]{"new", "contacted", "rejected", "archived"}, "/api/admin/partner-applications/" + item.optString("id") + "/status", () -> applications(false)));
            }
        }, null);
    }
    private void contacts(boolean child) {
        app.screen("Обращения", () -> contacts(false), child);
        app.run(() -> app.api.request("GET", "/api/admin/contact-requests", null, true), value -> {
            JSONArray contacts = (JSONArray) value;
            if (contacts.length() == 0) note("Обращений пока нет");
            for (int i = contacts.length() - 1; i >= 0; i--) {
                JSONObject item = contacts.getJSONObject(i); LinearLayout card = app.card(app.column); title(card, item.optString("name"));
                app.text(card, switch (item.optString("status")) { case "new" -> "Новое"; case "in_progress" -> "В работе"; case "closed" -> "Вопрос решён"; default -> "В архиве"; }, 16, TEAL);
                app.details(card, "Сообщение", item.optString("message")); app.details(card, "Телефон", item.optString("phone")); app.details(card, "Email", item.optString("email")); dial(card, item.optString("phone"));
                app.button(card, "Изменить статус", false, () -> selectStatus("Статус обращения", new String[]{"Новое", "В работе", "Вопрос решён", "В архиве"}, new String[]{"new", "in_progress", "closed", "archived"}, "/api/admin/contact-requests/" + item.optString("id") + "/status", () -> contacts(false)));
            }
        }, null);
    }
    void more(boolean child) {
        if (!guard()) return;
        app.screen("Управление проектом", () -> more(false), child);
        app.button(app.column, "Заявки заведений", true, () -> applications(true));
        app.button(app.column, "Все предложения", false, () -> offers("", true));
        app.button(app.column, "Обращения покупателей и партнёров", false, () -> contacts(true));
        app.button(app.column, "История действий", false, () -> audit(true));
        app.button(app.column, "Изменить мой пароль", false, () -> password(true));
        app.button(app.column, "Перейти к покупкам", false, this::exitToCustomer);
        app.button(app.column, "Выйти из админ-панели", false, () -> confirm("Выйти из админ-панели?", "Для следующего входа понадобится пароль.", () -> app.mutate(() -> {
            try { app.api.request("POST", "/api/admin/auth/logout", new JSONObject(), true); }
            catch (java.io.IOException error) { /* Local exit remains available offline. */ }
            catch (ApiClient.Failure error) { /* Revoked sessions cannot keep the local cabinet open. */ }
            finally { app.api.forgetAdminSession(); }
            return new JSONObject();
        }, value -> app.exitAdmin(), null)));
    }
    private void audit(boolean child) {
        app.screen("История действий", () -> audit(false), child);
        note("Последние действия в проекте. История не редактируется.");
        app.run(() -> app.api.request("GET", "/api/admin/audit-log", null, true), value -> {
            JSONArray audit = (JSONArray) value;
            for (int i = audit.length() - 1; i >= Math.max(0, audit.length() - 100); i--) {
                JSONObject item = audit.getJSONObject(i); LinearLayout row = app.card(app.column);
                title(row, actionName(item.optString("action"))); app.details(row, "Когда", AppRules.friendlyTimestamp(item.optString("createdAt")));
                String actor = item.optString("actorRole");
                app.details(row, "Кто", "admin".equals(actor) ? "Администратор" : "partner".equals(actor) ? item.isNull("actorName") ? "Сотрудник заведения" : item.optString("actorName") : "Система");
                if (!item.isNull("referenceLabel")) app.details(row, "Что изменилось", item.optString("referenceLabel"));
                if (!item.isNull("status")) app.details(row, "Статус", "partner".equals(item.optString("entityType")) ? partnerStatus(item.optString("status")) : AppRules.status(item.optString("status")));
                if (!item.isNull("reason")) app.details(row, "Причина исправления", item.optString("reason"));
            }
        }, null);
    }
    void password(boolean child) {
        app.screen("Пароль администратора", () -> password(false), child);
        note(app.adminPasswordChangeRequired ? "Замените временный пароль на постоянный, чтобы начать работу." : "Новый пароль будет действовать и на сайте.");
        EditText old = app.passwordField(app.column, "Текущий пароль"); EditText next = app.passwordField(app.column, "Новый пароль — от 12 символов"); EditText repeat = app.passwordField(app.column, "Повторите новый пароль");
        Button save = app.button(app.column, "Изменить пароль", true, () -> { });
        save.setOnClickListener(view -> {
            String value = next.getText().toString(); if (value.length() < 12 || !value.equals(repeat.getText().toString())) { app.message("Нужно не менее 12 символов. Пароли должны совпадать."); return; }
            app.mutate(() -> app.api.request("POST", "/api/admin/auth/change-password", app.json("currentPassword", old.getText().toString(), "newPassword", value, "confirmPassword", repeat.getText().toString()), true), result -> {
                old.setText(""); next.setText(""); repeat.setText(""); app.adminPasswordChangeRequired = false; app.message("Пароль изменён"); app.openAdminTab("admin-overview");
            }, save);
        });
    }
    void exitToCustomer() { confirm("Вернуться к покупкам?", "Вход администратора сохранится на этом телефоне до выхода или окончания сессии.", app::exitAdmin); }
    private void selectStatus(String title, String[] names, String[] keys, String path, Runnable refresh) {
        new AlertDialog.Builder(app).setTitle(title).setItems(names, (dialog, which) -> confirm("Сохранить этот статус?", names[which], () -> app.mutate(() -> app.api.request("PATCH", path, app.json("status", keys[which]), true), value -> refresh.run(), null))).setNegativeButton("Не менять", null).show();
    }
    private void dial(LinearLayout parent, String phone) { if (phone == null || phone.isEmpty()) return; app.button(parent, "Позвонить", false, () -> app.startActivity(new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + phone.replaceAll("[^+0-9]", ""))))); }
    private void confirm(String title, String text, Runnable action) { new AlertDialog.Builder(app).setTitle(title).setMessage(text).setNegativeButton("Не менять", null).setPositiveButton("Подтвердить", (dialog, which) -> action.run()).show(); }
    private void title(LinearLayout parent, String value) { app.text(parent, value, 21, INK).setTypeface(null, Typeface.BOLD); }
    private void note(String value) { app.text(app.column, value, 16, MUTED); }
    private String roleName(String value) { return switch (value) { case "owner" -> "Владелец"; case "manager" -> "Менеджер"; default -> "Продавец"; }; }
    private String partnerStatus(String value) { return switch (value) { case "active" -> "Работает"; case "paused" -> "Работа приостановлена"; case "disabled" -> "Отключено"; case "archived" -> "В архиве"; default -> "Обновите данные"; }; }
    private String applicationStatus(String value) { return switch (value) { case "new" -> "Новая заявка"; case "contacted" -> "Уже связались"; case "approved" -> "Подключено"; case "rejected" -> "Отклонено"; default -> "В архиве"; }; }
    private String actionName(String value) { return switch (value) { case "create_booking" -> "Оформлена бронь"; case "set_booking_status" -> "Изменён статус брони"; case "correct_booking_status" -> "Исправлена завершённая бронь"; case "create_offer" -> "Добавлено предложение"; case "onboard_partner" -> "Подключено заведение"; case "create_partner_user" -> "Добавлен сотрудник"; case "archive_partner" -> "Заведение отправлено в архив"; default -> "Данные проекта изменены"; }; }
}
