# Бери сегодня

MVP локального сервиса ограниченных предложений еды на сегодня.

Клиент выбирает предложение, получает код, приходит в заведение, оплачивает при получении и забирает заказ.

## Текущий стек

- Node.js HTTP server: `server.mjs`
- Server-side JSON storage: `data/db.json`
- Partner photo storage: `data/uploads/`
- HTML/CSS/JS без frontend-сборки
- Basic Auth preview gate
- HttpOnly cookie sessions для admin/partner API

JSON выбран как dependency-free storage закрытого однопроцессного MVP. Архитектура разделена на storage/repositories/services, чтобы заменить его на PostgreSQL до роста нагрузки или запуска нескольких процессов.

## Запуск

```bash
npm run dev
```

Если `npm` недоступен:

```bash
node server.mjs
```

URL:

```text
http://localhost:3010
```

## Документация

- `docs/ARCHITECTURE.md`
- `docs/DATABASE.md`
- `docs/API.md`
- `docs/AUTH.md`
- `docs/ACCESS.md`
- `docs/SECURITY.md`
- `docs/SECURITY_HARDENING_CHECKLIST.md`
- `docs/LOCAL_DEVELOPMENT.md`
- `docs/DEPLOYMENT.md`
- `docs/VPS_DEPLOY_STEP_BY_STEP.md`
- `docs/STAGING_CHECKLIST.md`
- `docs/ENVIRONMENT.md`
- `docs/DEPLOYMENT_READINESS_CHECKLIST.md`
- `docs/LEGAL_RKN_CHECKLIST.md`
- `docs/HANDOVER.md`
- `docs/GO_LIVE_CHECKLIST.md`
- `docs/RUNBOOK.md`
- `docs/PILOT_READINESS.md`
- `docs/ANDROID_PILOT_APK_2026-08-27.md`
- `docs/PRODUCT_STRATEGY_ARMAVIR.md`
- `docs/PARTNER_QUICK_PUBLISH.md`
- `docs/OWNER_GUIDE.md`
- `AGENTS.md`

## Данные

Источник правды теперь сервер:

- партнёры;
- адреса;
- пользователи партнёров;
- предложения;
- брони;
- заявки партнёров;
- обращения;
- сессии;
- audit log.

Старые localStorage-данные демо-версии больше не используются.

## Доступы для локальной проверки

Пароли не хранятся в репозитории. Preview Basic Auth, администратор и три демонстрационных seed-пользователя получают уникальные значения через `.env.local` или переменные окружения. Перед `db:seed`/`db:reset` задайте `SEED_PARTNER_1_PASSWORD`, `SEED_PARTNER_2_PASSWORD` и `SEED_PARTNER_3_PASSWORD` длиной не менее 12 символов. Не используйте эти значения в production.

`ADMIN_ACCESS_ENABLED` и `PARTNER_ACCESS_ENABLED` по умолчанию выключены: роли защищены внутренними HttpOnly-сессиями. Их Basic Auth можно включить только как дополнительный аварийный слой закрытого стенда.

## Команды

```bash
npm run check:server
npm run build
npm run db:migrate
npm run db:seed
npm run db:reset
npm run test:api
npm run test:smoke
npm run test:android-config
npm run test:published-apk
npm run test:backup
npm run backup:data
npm run restore:data -- backups/db-YYYY-MM-DD-HH-mm-ss.json
```

В текущей среде без `npm` можно запускать напрямую:

```bash
node backend/db/migrate.mjs
node backend/db/seed.mjs
node scripts/smoke-test.mjs
node scripts/backup-data.mjs
node scripts/prune-backups.mjs
node scripts/restore-data.mjs backups/db-YYYY-MM-DD-HH-mm-ss.json
```

## Backup / Restore

Текущее MVP-хранилище: `data/db.json`.

Создать backup:

```bash
npm run backup:data
```

Восстановить из backup:

```bash
npm run restore:data -- backups/db-YYYY-MM-DD-HH-mm-ss.json
```

Restore перед заменой `data/db.json` создаёт backup текущего файла.
Backup/restore также сохраняет соответствующий снимок `data/uploads/`, где лежат фотографии предложений.

## Env

См. `.env.example`.

Важные переменные:

- `SITE_ACCESS_ENABLED`
- `SITE_ACCESS_USER`
- `SITE_ACCESS_PASSWORD_SHA256`
- `ADMIN_ACCESS_ENABLED`
- `ADMIN_ACCESS_USER`
- `ADMIN_ACCESS_PASSWORD_SHA256`
- `ADMIN_APP_LOGIN`
- `ADMIN_APP_PASSWORD_HASH`
- `ADMIN_APP_PASSWORD_SALT`
- `ADMIN_APP_PASSWORD_ITERATIONS`
- `PARTNER_ACCESS_ENABLED`
- `PARTNER_ACCESS_USER`
- `PARTNER_ACCESS_PASSWORD_SHA256`
- `SESSION_SECRET`
- `APP_BASE_URL`
- `APP_DOMAIN`
- `PORT`
- `HOST` (для VPS за Caddy рекомендуется `127.0.0.1`)
- `DB_DRIVER`
- `DB_FILE`
- `UPLOAD_DIR`
- `LEGAL_OPERATOR_READY` и реквизиты `LEGAL_*`
- `PUBLIC_SUPPORT_EMAIL` и необязательный `PUBLIC_SUPPORT_PHONE`

Access instructions are in `docs/ACCESS.md`. Deployment guidance is in `docs/DEPLOYMENT.md`; the current architecture is best deployed to a VPS with a persistent disk.

## Деплой

Для текущей архитектуры рекомендуется VPS с постоянным диском:

- Node.js `24.19.0` LTS for CI and the application process;
- PM2;
- Caddy или Nginx;
- HTTPS;
- backup `data/db.json`.

Пошаговая инструкция: `docs/VPS_DEPLOY_STEP_BY_STEP.md`.

Безопасный переход существующего VPS на app-specific Node 24 без замены
системного Node: `docs/NODE24_RUNTIME_MIGRATION.md`.

Короткий staging-чеклист: `docs/STAGING_CHECKLIST.md`.

Serverless/Vercel не использовать как основной вариант, пока данные хранятся в `data/db.json` или локальной SQLite. Для serverless потребуется внешняя БД и отдельная адаптация repository layer.

## Ограничения MVP

- JSON storage допустим только для закрытого однопроцессного пилота; перед ростом нужен PostgreSQL.
- Нет email/SMS-уведомлений.
- Нет онлайн-оплаты.
- Нет доставки.
- Не требуется подключение к внешним учётным системам.
- Нет реальных партнёров и реальных адресов.

Изолированный `npm run test:smoke` сам запускает сервер на свободном loopback-порту и использует временную БД. Команда не изменяет `data/db.json`.

## Перед публичным запуском

- production env заполнен;
- VPS настроен;
- HTTPS включен;
- backup работает и restore проверен;
- юридические страницы заполнены реквизитами оператора;
- вопрос уведомления РКН проверен;
- тестовые пароли заменены;
- тестовые данные удалены или явно помечены;
- реальные партнёры, адреса, предложения и фото согласованы;
- `noindex` снят только после полной готовности к публичному запуску.
