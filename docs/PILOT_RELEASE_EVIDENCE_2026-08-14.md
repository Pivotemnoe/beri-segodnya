# Доказательства выпуска закрытого пилота — 14.08.2026

## Итог

- Web/PWA release развернут на `https://berisegodnya.ru` и прошел live-приемку.
- Приложение переведено на app-specific Node `24.19.0` после локального, VPS staging и изолированного PM2 gate; системный `/usr/bin/node` и другие сервисы не изменялись.
- Внутренняя техническая репетиция под новым Basic Auth и только с тестовыми данными — `GO`.
- Закрытый пилот с реальными клиентами и персональными данными — `NO-GO`, пока оператор не заполнит юридические реквизиты и не завершит legal/RKN gate. До этого формы на сервере возвращают `503 LEGAL_NOT_READY` и ничего не сохраняют.
- Публичный запуск — `NO-GO`: дополнительно нужны подтвержденное предложение партнеров, app-specific monitoring, retention/incident process и внешний security review.
- Исходник Android/TWA готов, но подписанный APK и emulator/device smoke не подтверждены: установка Android SDK ожидает явного принятия лицензии Google.

## Идентичность release

- Ветка: `codex/pilot-hardening`.
- Развернутый commit: `1aee6d2` (`chore(runtime): pin Node 24 LTS pilot gate`).
- SHA-256 release-архива: `adb4dc3b763fefe2481a1d21f1c803755268f9f16e6716393d042c962b8dbe02`.
- Время переключения: `2026-08-14T18:25:43Z`.
- Маркер на VPS: `/var/www/beri-segodnya/.release.json`, режим `0600`.
- Production storage, `.env.local`, `data/db.json`, `data/uploads/`, `backups/` и `logs/` не заменялись release-архивом.

## Preflight VPS

- Прямой SSH на `89.169.46.92:22`; сетевой туннель не нужен.
- Приложение: один PM2 fork-процесс `beri-segodnya` под пользователем `deploy`.
- Приложение: Node `24.19.0` из `/opt/beri-segodnya/node-v24.19.0-linux-x64/bin/node`; PM2 dump сохранен с этим interpreter. Системный Node `18.19.1` не заменялся. Приложение слушает только `127.0.0.1:3010`.
- Caddy, UFW и fail2ban активны; наружу разрешены `22`, `80`, `443`.
- Диск: 38 ГБ, свободно около 8,8 ГБ, занято 77%; inode usage 16%.
- Zabbix agent присутствует, но доставка app-specific uptime/error/backup alert ответственному отдельно не подтверждена.

## Backup и rollback

До release создана root-only копия:

`/var/backups/beri-segodnya/pilot-hardening-20260814T171902Z`

Она содержит application tar, DB, uploads, `.env.local`, Caddyfile, PM2 dump, контрольные counts и `SHA256SUMS`. Режим каталога `0700`, файлов `0600`. Архив распакован во временный каталог; DB, env и uploads совпали, `RESTORE_REHEARSAL=PASS`.

После первого web/PWA release и ротации credentials создана post-deploy копия:

`/var/backups/beri-segodnya/pilot-hardening-postdeploy-20260814T174320Z`

Все восемь записей в `SHA256SUMS` прошли проверку; отдельная временная распаковка и сравнение DB/env завершились `POSTDEPLOY_RESTORE=PASS`.

Штатный `npm run backup:data` также выполнен на live. Он создал DB `0600`, uploads-каталог `0700` и integrity manifest `0600`. Cron пользователя `deploy` запускает backup ежедневно в 03:00 UTC и prune в 03:30 UTC.

Перед миграцией runtime создана root-only копия
`/var/backups/beri-segodnya/node24-migration-20260814T182333Z`: 10 записей
manifest прошли SHA-256, stateless archive был распакован, DB/env совпали,
`RESTORE_REHEARSAL=PASS`.

После Node 24 switch и live role acceptance создана предпочтительная копия
`/var/backups/beri-segodnya/node24-postdeploy-20260814T183446Z`: 12 записей
manifest прошли SHA-256, DB/env/uploads совпали при временном восстановлении,
`POSTDEPLOY_RESTORE=PASS`. Отдельный штатный backup на Node 24 создал
`db/uploads/manifest-2026-08-14-18-26-10` с корректными режимами и hash
verification. Обе cron-команды теперь используют app-specific Node 24; prune
был безопасно проверен с retention `99999` дней и ничего не удалил.

Rollback runtime: передать `BERI_SEGODNYA_NODE=/usr/bin/node` в
`pm2 startOrReload ecosystem.config.cjs --only beri-segodnya --update-env`,
восстановить сохраненный deploy-crontab и повторить health/count checks. Rollback
кода: восстановить stateless-код из pre-deploy tar или проверенного
release-каталога, не заменяя post-rotation DB/env без отдельного решения.

## Staging-gate на самом VPS

Release `1aee6d2` был распакован в отдельный каталог и проверен на точном Node
`24.19.0` до изменения live:

- `npm run build` — PASS, 39 JavaScript modules/contracts;
- `npm run test:security` — PASS, 160 release-artifact files/contracts без `.git`;
- `npm run test:backup` — PASS во временном каталоге;
- `npm run test:api` — PASS на изолированной временной DB и фиксированных только внутри теста часах;
- `npm audit --omit=dev` — 0 vulnerabilities;
- отдельный временный `PM2_HOME` запустил staging release на app-specific Node
  `24.19.0`, вернул HTTP `200`, показал правильный interpreter/cwd и был удален.

Первый локальный Node 24 run также выявил недетерминированность smoke-test после
окончания вечерних интервалов выдачи. Тестовый clock был зафиксирован только в
изолированном child process; production clock не менялся. Повторный полный gate
прошел локально и на VPS.

## Целостность данных

| Коллекция | До release | После release/rotation/acceptance | Комментарий |
|---|---:|---:|---|
| partners | 7 | 7 | без изменений |
| partnerUsers | 6 | 6 | 3 опубликованных пароля заменены |
| partnerAddresses | 6 | 6 | без изменений |
| offers | 6 | 6 | без изменений |
| bookings | 3 | 3 | тестовые negative-запросы ничего не создали |
| partnerApplications | 3 | 3 | без изменений |
| contactRequests | 3 | 3 | без изменений |
| offerTemplates | 3 | 3 | без изменений |
| sessions | 9 | 0 | старые сессии отозваны, acceptance-сессии закрыты |
| auditLog | 42 | 56 | ожидаемые acceptance login events двух выпусков |

## Ротация доступов

- Ранее опубликованные preview, admin и три partner credentials сначала были воспроизведены как действующие, после чего тестовые сессии немедленно закрыты.
- Preview password, admin password и три совпавших partner passwords заменены; 9 прежних сессий отозваны.
- Контроль после ротации: все старые доступы — `401`; новые preview/admin/partner — `200`; новые тестовые сессии завершены.
- Новые значения отсутствуют в Git, Word и логах. Они хранятся в root-only post-deploy backup и в отдельном локальном файле `0600` вне репозитория.
- Остаточный инфраструктурный риск: текущий рабочий root-ключ имеет имя другого проекта, а root/password SSH еще разрешены. Нужен отдельный key для `deploy`; отключать root/password можно только после контрольного входа новым ключом и проверки влияния на остальные сервисы VPS.

## Live acceptance

- `/`, manifest, service worker, offline page, icons, `assetlinks.json`, page config, public JS и public offers — `200`.
- Admin и partner protected API без role session — `401`.
- CSP не содержит `unsafe-inline`, содержит `form-action 'self'`; HSTS, COEP, COOP, CORP, Origin-Agent-Cluster, no-store, noindex, frame deny и nosniff подтверждены на HTTPS.
- PWA: `display=standalone`, `start_url=/?source=pwa`, 192/512/maskable icons, package `ru.berisegodnya.app`, один release fingerprint.
- Service worker пропускает мимо cache все не-GET, API, admin, partner, booking, uploads и внешние origins.
- Юридическая конфигурация намеренно не готова: booking POST — `503 LEGAL_NOT_READY` без записи.
- Missing `X-BS-Request` — `403 REQUEST_CONFIRMATION_REQUIRED`; чужой Origin — `403 ORIGIN_NOT_ALLOWED`.
- Malformed URL — `400`, процесс остается online; error-log после release не изменился.
- Client, admin и partner проверены в реальном браузере на live-коде в `1280×720` и `390×844`. Document-level horizontal overflow и технические тексты не обнаружены; dashboard каждой роли открылся с новыми credentials.
- После Node 24 switch отдельный HTTPS acceptance выполнил 36 проверок: public/PWA endpoints, preview gate, CSP, non-technical errors, request-confirmation/origin negatives, legal `503`, admin и три partner login/dashboard/profile/role-boundary/logout. Все проверки — `PASS`, credentials не выводились, sessions вернулись к `0`, business counts не изменились, error-log остался `14332` bytes.
- Screenshots сохранены вне Git в `audit-beri-segodnya-2026-08-14/final/`.

## Не закрыто этим release

- юридические реквизиты оператора, решение по РКН/локализации и юридическая проверка документов;
- подписанная APK-сборка, `apksigner` verification и установка на emulator/реальное Android-устройство;
- реальный iPhone/Android standalone flow и камера на устройстве;
- подтвержденные партнеры, права на контент и supply SLA;
- app-specific alerts, retention/purge и внешний authenticated penetration test;
- отдельный SSH key для `deploy` и последующее решение по root/password SSH;
- push ветки и draft PR: локальный `gh` token недействителен, требуется `gh auth login`.
