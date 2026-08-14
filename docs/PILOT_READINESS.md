# Готовность пилота

## Текущее решение после release 14.08.2026

- Внутренняя техническая репетиция под новым Basic Auth, только на тестовых данных — **GO**.
- Web/PWA/runtime release `1aee6d2` развернут и принят на live; backup/restore, role access, credential rotation, desktop/mobile, security negatives и app-specific Node `24.19.0` подтверждены.
- Android/TWA source hardening завершён локальным commit `f2dd0e3`: AGP `9.3.1`, Gradle `9.5.0`, lock/verification metadata, release OSV gate и signing preflight подтверждены. Подписанный APK пока не собран и не проверен на устройстве.
- Закрытый пилот с реальными клиентами и ПДн — **NO-GO**, пока не заполнены реквизиты оператора и не закрыт legal/RKN gate. Публичные формы до этого безопасно возвращают `503 LEGAL_NOT_READY`.
- Публичный городской запуск — **NO-GO**.
- Подробный протокол: `docs/PILOT_RELEASE_EVIDENCE_2026-08-14.md`.

## Закрыто в коде

- публичная витрина показывает только активные предложения текущего дня до окончания выдачи;
- источник правды только server-side storage;
- бронь атомарно уменьшает остаток;
- отмена возвращает остаток, если предложение еще доступно;
- у брони есть постоянная закрытая ссылка с кодом и статусом;
- admin и partner API требуют внутреннюю HttpOnly-сессию с проверкой роли; partner API дополнительно ограничен `partner_id`;
- партнерские запросы ограничены `partner_id` из сессии;
- отключенный партнер теряет доступ даже с ранее созданной сессией;
- сессионные токены хранятся только как SHA-256 hash;
- входы и публичные формы имеют rate limit;
- изменяющие запросы с чужим `Origin` отклоняются;
- тело JSON ограничено 32 КБ;
- ошибки API не завершают Node-процесс;
- smoke-test работает на отдельном временном файле и удаляет его после проверки;
- CI проверяет все `.mjs` и полный smoke-сценарий;
- PWA manifest, icons, safe service worker, offline page и install UI развернуты;
- опубликованные preview/admin/partner passwords заменены, старые сессии отозваны;
- live backup script и четыре restore rehearsal прошли.
- app-specific Node `24.19.0`, PM2 interpreter, cron и rollback проверены без замены системного Node.
- Android wrapper закрепляет JDK 17, AGP `9.3.1`, Gradle `9.5.0`, 53 release dependencies и SHA-256 для 627 артефактов; release OSV gate не нашёл известных уязвимостей.
- signing preflight сопоставляет закрытый ключ, alias, public fingerprint и Digital Asset Links без вывода секрета; CI source gate использует read-only permissions и immutable action SHAs.

## Допустимо только для закрытого пилота

- один Node-процесс;
- server-side JSON с атомарной заменой файла;
- in-memory rate limit;
- ручная выдача по коду;
- одна городская конфигурация: Армавир;
- Basic Auth поверх публичного staging.

## Блокирует публичный production

- не заполнены реквизиты оператора в юридических документах;
- не завершена проверка РКН и локализации персональных данных;
- не подтверждены реальные партнеры, ассортимент и права на фотографии;
- нет внешнего uptime/error monitoring;
- JSON не рассчитан на несколько процессов и растущую конкурентную запись;
- нет формализованной политики сроков хранения и удаления персональных данных;
- нет подтвержденного процесса обработки жалоб и инцидентов.
- не выполнены signed APK build/install/device acceptance и GitHub run нового Android CI gate.

## Перед приглашением первых пользователей

1. Получить и юридически проверить реквизиты оператора, consent/policy/terms и решение по РКН/локализации.
2. Не включать `LEGAL_OPERATOR_READY=true`, пока legal gate не подписан.
3. Оставить новый Basic Auth и `noindex` на весь закрытый этап.
4. Создать только согласованные реальные карточки партнеров и подтвердить права на фото/описания.
5. Пройти реальный Android/iPhone PWA standalone flow, camera/background/resume.
6. После явной фразы `Да, принимаю лицензию Android SDK` установить необходимые SDK packages, собрать, проверить и установить signed APK на доступный `adb` target.
7. Назначить ответственных за поддержку, ПДн, incident response и ежедневный supply.
8. Подтвердить 5–8 точек и не менее 12 наборов в обычный день до платного трафика.
9. Добавить app-specific uptime/error/disk/backup alerts и проверить доставку.
10. Создать отдельный SSH key для `deploy`; root/password hardening выполнять только после контрольного входа.
