# План устранения замечаний аудита

Актуально на 14 августа 2026 года. Документ ведётся по фактическим проверкам локального проекта, GitHub и закрытого стенда `berisegodnya.ru`.

## Правило выпуска

Каждый пакет изменений проходит отдельно:

1. автоматические тесты на временной базе;
2. проверку интерфейса на компьютере и телефоне;
3. отдельный commit;
4. резервную копию production перед установкой;
5. проверку хешей, состояния PM2 и ключевых live-сценариев после установки.

Production-данные, `.env.local`, `data/db.json`, `data/uploads/` и серверные резервные копии не входят в Git и не заменяются кодовым релизом.

## Исходное состояние

- Исходный код live-стенда совпадал с commit `1447c83c1d0b2b8a688adc4179a55cf71c5b86e1`; после аудита и runtime hardening развернут release `1aee6d2`.
- Приложение работает одним Node-процессом под PM2 от пользователя `deploy`.
- Node слушает только `127.0.0.1:3010`; наружу открыты `22`, `80`, `443`.
- Caddy, UFW, fail2ban и `pm2-deploy` активны.
- Вход клиента, администратора и партнёра подтверждён на live.
- SSH работает напрямую на `89.169.46.92:22`; туннель не используется.
- На VPS пока разрешены root-вход и парольная SSH-аутентификация.
- GitHub-репозиторий публичный; ранее опубликованные пароли остаются в истории, поэтому preview/admin/три partner credentials заменены, старые значения возвращают `401`, 9 прежних сессий отозваны.
- PWA manifest, safe service worker, install UI, icons и Digital Asset Links развернуты на live; Android/TWA source усилен локально отдельным commit `f2dd0e3` и не требует web-деплоя.

## Пакет 1. P0: персональные данные и доступ

- [x] Обязательная server-side проверка согласия во всех публичных формах.
- [x] Сохранение версии документа, времени, формы и источника согласия.
- [x] Блокировка сбора ПДн, пока не заполнены реквизиты оператора.
- [x] Привязка partner-сессии к `user_id` и роли пользователя.
- [x] Проверка статуса пользователя при каждом защищённом запросе.
- [x] Немедленный отзыв сессий при отключении пользователя или смене пароля.
- [x] Server-side разграничение полномочий владельца и менеджера.
- [x] Безопасный общий ответ на неожиданные ошибки с request id.
- [x] Строгая same-origin защита изменяющих запросов.
- [x] Ограниченная по памяти очистка rate-limit buckets.
- [x] Backup-файлы `0600`, каталоги `0700`, парное удаление DB и uploads.
- [x] Негативные smoke-тесты для consent, revoked session, role и CSRF.

Проверено локально и в отдельном release-каталоге VPS: `npm run test:api`, `npm run test:backup`, `npm run test:security`, `npm run build`. На live `SESSION_SECRET` готов, admin и совпавшие partner hashes перевыпущены с 600000 PBKDF2 iterations; юридические переменные пока отсутствуют, поэтому сбор ПДн безопасно закрыт.

## Пакет 2. P1: клиентский сценарий

- [x] Полезное пустое состояние без большой пустой области.
- [x] Время выдачи в мобильном списке.
- [x] Правильные формы `набор / набора / наборов`.
- [x] Нейтральная подпись фото без неподтверждённого обещания «сегодня».
- [x] Корректный экран отменённой брони.
- [x] Очистка устаревшей ссылки «Моя бронь».
- [x] Доступные dialog/drawer: focus trap, Escape, возврат фокуса, aria-label.
- [x] Понятные сообщения о сети, недоступности и закрытом приёме данных.

Проверено локально в реальном браузере на `390×844` и `1280×900`: каталог, карточка, форма, успешная бронь, двухшаговая отмена, пустой каталог и режим незаполненных юридических реквизитов. Горизонтального переполнения нет; после закрытия dialog фокус возвращается в исходную карточку. Повторно проходят `npm run build`, `npm run test:api` и `npm run test:backup`.

## Пакет 3. P1: партнёр и администратор

- [x] Удалить технические тексты про JSON, API, MVP, env и пути файлов.
- [x] Локализовать внутренние коды типов и статусов.
- [x] Поиск кода и фильтр текущих броней.
- [x] Подтверждение или undo для рискованных действий.
- [x] Очищать локальный черновик при выходе; добавить TTL и ручное удаление.
- [x] Показывать роль и скрывать недоступные менеджеру действия.
- [x] Лента аудита в админке с безопасными полями и фильтрами.
- [x] Поиск и фильтры в основных административных списках.
- [x] Понятная мобильная навигация по разделам.

Проверено локально в реальном браузере на `390×844` и `1440×900`: вход владельца/менеджера и администратора, ограничения менеджера, мастер публикации с TTL и удалением черновика, поиск и фильтры броней, двухшаговое подтверждение рискованных действий, безопасный журнал без идентификаторов и содержимого персональных данных, мобильные переключатели разделов. Горизонтального переполнения нет.

## Пакет 4. PWA и производительность

- [x] `manifest.webmanifest`, иконки 192/512 и maskable icon.
- [x] Service worker без кеширования API, auth, admin, partner, booking и ПДн.
- [x] Офлайн-страница с явным сообщением; создание/отмена офлайн запрещены.
- [x] Кнопка установки и инструкция для Android/iPhone.
- [x] `apple-touch-icon`, theme color, standalone display и update flow.
- [ ] Проверка installability и standalone на реальном Android/iPhone.
- [ ] Оптимизация изображений и измеримый performance budget.

## Пакет 5. APK и сервер

- [x] TWA-проект с фиксированным application id `ru.berisegodnya.app`.
- [x] `assetlinks.json` с fingerprint релизного ключа.
- [x] JDK 17, Android Gradle Plugin `9.3.1` и официальный Gradle `9.5.0` закреплены проверенными версиями.
- [x] Wrapper JAR, launcher scripts и distribution закреплены SHA-256; окончания строк wrapper-скриптов фиксированы через `.gitattributes`.
- [x] 53 release runtime dependencies заблокированы lockfile; 627 загружаемых артефактов проверяются SHA-256 без allowlist и слабых хешей.
- [x] Release OSV gate: известных уязвимостей в 53 зависимостях, попадающих в APK, не найдено.
- [x] `lintRelease`, R8, resource shrinking, strict dependency verification и fail-on-warning включены в source/CI contract.
- [x] Signing preflight на реальном закрытом ключе: режимы файлов, JDK, alias, fingerprint, Digital Asset Links и Gradle checksums — PASS; ключ и пароль в Git/лог не попадали.
- [ ] Подписанный sideload APK и установка через `adb`.
- [x] Релизный ключ вне Git; локальная signing-директория имеет private permissions.
- [ ] Отдельный SSH-ключ для `deploy`, проверка sudo и нового входа.
- [ ] Запрет root/password SSH только после успешного контрольного входа.
- [x] Контроль firewall/fail2ban, диска и backup cron; Zabbix agent присутствует.
- [x] App-specific Node `24.19.0`: official SHA-256, local/VPS gate, isolated PM2 rehearsal, live switch, cron и rollback evidence.
- [ ] Подтвердить доставку app-specific uptime/error/disk/backup alerts ответственному.
- [x] Четыре restore drill в отдельных временных каталогах, не на live-базе.

## Внешние блокеры

- Реквизиты оператора ПДн нельзя выдумывать: нужны утверждённые наименование, ИНН/ОГРН/ОГРНИП, адрес и email для обращений.
- Реальные партнёры, адреса, фотографии и ассортимент добавляются только после отдельного подтверждения прав и содержания.
- Публичный запуск остаётся закрыт до юридической проверки, решения по РКН и подтверждения локализации данных.
- Для push/PR требуется обновить локальную авторизацию GitHub CLI; текущий token недействителен.
- Локальный Android CI workflow настроен, но не считается выполненным до push и зелёного GitHub Actions run.
- Для signed APK/emulator smoke требуется явное решение пользователя: `Да, принимаю лицензию Android SDK`; лицензия автоматически не принималась, SDK packages не устанавливались.
- Для device acceptance нужен доступный `adb` target: сейчас подключённых устройств и эмуляторов нет.
- Расширенный OSV audit видит advisories в upstream AGP/lint/device-test инструментах (Netty, Commons Lang/HttpClient, jose4j, Bouncy Castle, JDOM и Kotlin Gradle plugin). Они отсутствуют в `releaseRuntimeClasspath` и APK, не скрыты allowlist и остаются отдельным trigger для обновления toolchain и изоляции CI.

## Фактический выпуск

- Pre-deploy backup: `/var/backups/beri-segodnya/pilot-hardening-20260814T171902Z`, hash и restore — PASS.
- Post-deploy backup: `/var/backups/beri-segodnya/pilot-hardening-postdeploy-20260814T174320Z`, hash и restore — PASS.
- Node 24 pre-switch backup: `/var/backups/beri-segodnya/node24-migration-20260814T182333Z`, hash и restore — PASS.
- Node 24 post-switch backup: `/var/backups/beri-segodnya/node24-postdeploy-20260814T183446Z`, hash и restore — PASS.
- Business counts сохранены: 7 партнеров, 6 пользователей, 6 адресов, 6 предложений, 3 брони, 3 заявки, 3 обращения, 3 шаблона.
- Sessions: `9 → 0` после обязательного revoke; audit log: `42 → 56` из-за ожидаемых acceptance login events двух выпусков.
- Live PWA/headers/role isolation/CSRF/legal gate, browser desktop/mobile и отдельные 36 HTTPS checks после Node 24 switch — PASS.
- Android source hardening: локальный commit `f2dd0e3`; build/security/config/release-OSV/offline Gradle/signing preflight — PASS. Этот commit не развертывался на VPS, потому что не меняет web runtime.
- Полный протокол: `docs/PILOT_RELEASE_EVIDENCE_2026-08-14.md`.
