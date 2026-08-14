import { generateId } from "../utils/id.mjs";
import { nowIso, todayDate } from "../utils/dates.mjs";
import { createPasswordHash } from "../utils/password.mjs";

function seedPassword(variable) {
  if (process.env.APP_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error("Demo seed is disabled in production. Restore a verified database backup instead.");
  }
  const value = String(process.env[variable] || "");
  if (value.length < 12 || /^replace[_-]/i.test(value)) {
    throw new Error(`${variable} must contain a unique password of at least 12 characters before demo seed can be created`);
  }
  return value;
}

function partnerUser(id, partnerId, login, password, name) {
  const { hash, salt, iterations } = createPasswordHash(password);
  const time = nowIso();
  return {
    id,
    partner_id: partnerId,
    name,
    login,
    password_hash: hash,
    password_salt: salt,
    password_iterations: iterations,
    role: "owner",
    status: "active",
    created_at: time,
    updated_at: time
  };
}

export function createSeedDb() {
  const time = nowIso();
  const partners = [
    {
      id: "partner-1",
      slug: "partner-1",
      name: "Тестовая кулинария",
      type: "culinary",
      contact_name: "Тестовый контакт",
      phone: "+7 (900) 000-00-00",
      email: "partner1@example.test",
      status: "active",
      created_at: time,
      updated_at: time
    },
    {
      id: "partner-2",
      slug: "partner-2",
      name: "Заведение 2",
      type: "bakery",
      contact_name: "Тестовый контакт",
      phone: "+7 (900) 000-00-00",
      email: "partner2@example.test",
      status: "active",
      created_at: time,
      updated_at: time
    },
    {
      id: "partner-3",
      slug: "test-bakery",
      name: "Тестовая пекарня",
      type: "bakery",
      contact_name: "Тестовый контакт",
      phone: "+7 (900) 000-00-00",
      email: "bakery1@example.test",
      status: "active",
      created_at: time,
      updated_at: time
    }
  ];

  const partnerAddresses = [
    {
      id: "partner-1-address-1",
      partner_id: "partner-1",
      title: "Основная точка",
      city: "Армавир",
      address: "Армавир, ул. Тестовая, 1",
      is_active: true,
      created_at: time,
      updated_at: time
    },
    {
      id: "partner-2-address-1",
      partner_id: "partner-2",
      title: "Точка 1",
      city: "Армавир",
      address: "ул. Примерная, 10",
      is_active: true,
      created_at: time,
      updated_at: time
    },
    {
      id: "partner-3-address-1",
      partner_id: "partner-3",
      title: "Основная точка",
      city: "Армавир",
      address: "Армавир, тестовый адрес",
      is_active: true,
      created_at: time,
      updated_at: time
    }
  ];

  const partnerUsers = [
    partnerUser("partner-user-1", "partner-1", "partner1", seedPassword("SEED_PARTNER_1_PASSWORD"), "Партнёр 1"),
    partnerUser("partner-user-2", "partner-2", "partner2", seedPassword("SEED_PARTNER_2_PASSWORD"), "Партнёр 2"),
    partnerUser("partner-user-3", "partner-3", "bakery1", seedPassword("SEED_PARTNER_3_PASSWORD"), "Тестовая пекарня")
  ];

  const offers = [
    {
      id: "test-lunch-1",
      partner_id: "partner-1",
      address_id: "partner-1-address-1",
      title: "Готовый обед сегодня",
      category: "lunch",
      price: 299,
      old_price: 420,
      description: "Сытный обед из горячего блюда, гарнира и свежего салата.",
      contents: "Курица, гречка, салат из огурцов и томатов, соус.",
      weight: "примерно 450 г",
      allergens: "Состав соуса уточняйте в точке",
      pickup_window: "15:30–18:00",
      total_quantity: 8,
      remaining_quantity: 8,
      status: "active",
      date: todayDate(),
      cta_label: "Получить код",
      image_alt: "Готовый обед",
      image_url: "/images/offer-lunch-v2.png",
      image_urls: ["/images/offer-lunch-v2.png"],
      photo_captured_at: time,
      source_type: "quick_photo",
      created_at: time,
      updated_at: time
    },
    {
      id: "test-bakery-1",
      partner_id: "partner-2",
      address_id: "partner-2-address-1",
      title: "Набор выпечки",
      category: "bakery",
      price: 249,
      old_price: 500,
      description: "Ассорти свежей выпечки, собранное в один набор на вечер.",
      contents: "Круассаны, булочки и хлеб. Фактический состав может немного отличаться.",
      weight: "5–7 изделий",
      allergens: "Глютен, молочные продукты; подробности уточняйте в точке",
      pickup_window: "19:00–20:00",
      total_quantity: 5,
      remaining_quantity: 5,
      status: "active",
      date: todayDate(),
      cta_label: "Забронировать",
      image_alt: "Набор выпечки",
      image_url: "/images/offer-bakery-v2.png",
      image_urls: ["/images/offer-bakery-v2.png"],
      photo_captured_at: time,
      source_type: "quick_photo",
      created_at: time,
      updated_at: time
    },
    {
      id: "test-evening-1",
      partner_id: "partner-3",
      address_id: "partner-3-address-1",
      title: "Вечерний набор",
      category: "evening",
      price: 349,
      old_price: 650,
      description: "Готовый набор на двоих, который удобно забрать по пути домой.",
      contents: "Горячее блюдо, гарнир, запечённые овощи и салат.",
      weight: "примерно 900 г",
      allergens: "Уточняйте у сотрудника заведения",
      pickup_window: "19:30–21:00",
      total_quantity: 6,
      remaining_quantity: 6,
      status: "active",
      date: todayDate(),
      cta_label: "Получить код",
      image_alt: "Вечерний набор еды",
      image_url: "/images/offer-evening-v2.png",
      image_urls: ["/images/offer-evening-v2.png"],
      photo_captured_at: time,
      source_type: "quick_photo",
      created_at: time,
      updated_at: time
    }
  ];

  const offerTemplates = [
    {
      id: "template-partner-1-set-1",
      partner_id: "partner-1",
      address_id: "partner-1-address-1",
      title: "Набор 1",
      category: "lunch",
      description: "Готовый набор на сегодня.",
      contents: "Состав укажите при публикации текущей партии.",
      price: 299,
      old_price: 420,
      pickup_window: "15:30–18:00",
      total_quantity: 8,
      image_urls: ["/images/offer-lunch-v2.png"],
      is_active: true,
      created_at: time,
      updated_at: time
    },
    {
      id: "template-partner-1-set-2",
      partner_id: "partner-1",
      address_id: "partner-1-address-1",
      title: "Набор 2",
      category: "evening",
      description: "Набор готовой еды на вечер.",
      contents: "Состав укажите при публикации текущей партии.",
      price: 349,
      old_price: 520,
      pickup_window: "18:00–20:00",
      total_quantity: 6,
      image_urls: ["/images/offer-evening-v2.png"],
      is_active: true,
      created_at: time,
      updated_at: time
    },
    {
      id: "template-partner-1-set-3",
      partner_id: "partner-1",
      address_id: "partner-1-address-1",
      title: "Набор 3",
      category: "bakery",
      description: "Набор выпечки текущего дня.",
      contents: "Состав укажите при публикации текущей партии.",
      price: 199,
      old_price: 320,
      pickup_window: "17:00–19:00",
      total_quantity: 5,
      image_urls: ["/images/offer-bakery-v2.png"],
      is_active: true,
      created_at: time,
      updated_at: time
    }
  ];

  return {
    partners,
    partnerUsers,
    partnerAddresses,
    offers,
    offerTemplates,
    bookings: [],
    partnerApplications: [],
    contactRequests: [],
    sessions: [],
    auditLog: [
      {
        id: generateId("audit"),
        actor_role: "system",
        actor_id: "seed",
        action: "seed_database",
        entity_type: "database",
        entity_id: null,
        metadata_json: "{}",
        created_at: time
      }
    ]
  };
}
