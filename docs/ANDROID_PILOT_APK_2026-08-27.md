# Android APK для пилота — 27.08.2026

## Что собрано

- имя файла: `beri-segodnya-android-0.1.0-pilot.apk`;
- package: `ru.berisegodnya.app`;
- version: `0.1.0-pilot`, version code `1`;
- минимум: Android 6 (`minSdk 23`);
- target: Android 16 (`targetSdk 36`);
- SHA-256: `ce94ec4bcbb0727f643e3419e9dcc5e840bc11937c0b1af1a493ba03f45f63e8`;
- размер: около 1,9 МБ.

APK — это подписанная TWA-оболочка сайта `https://berisegodnya.ru/`. Ей нужен интернет; предложения, брони и личные кабинеты остаются серверными функциями сайта.

## Что проверено

- `lintRelease`, R8 и resource shrinking;
- Gradle strict dependency verification: 53 release dependencies и 634 SHA-256-проверенных артефакта;
- APK Signature Scheme v1, v2 и v3;
- сертификат APK совпадает с fingerprint в `public/.well-known/assetlinks.json`;
- `zipalign`;
- package, version, `minSdk`, `targetSdk` и launcher activity;
- SHA-256 опубликованной копии;
- закрытый ключ и пароль не добавлены в Git и не публикуются.

## Публикация

- страница: `/android`;
- APK: `/downloads/beri-segodnya-android-0.1.0-pilot.apk`;
- checksum: `/downloads/beri-segodnya-android-0.1.0-pilot.apk.sha256`;
- сервер отдаёт APK как attachment с типом `application/vnd.android.package-archive`;
- публичная страница загрузки показывает только QR-код и кнопку скачивания, без технических сведений о сборке;
- ссылка на страницу видна на первом экране главной, в основной навигации, мобильном меню и подвале;
- CI повторно проверяет хеш, подпись, fingerprint и манифест публичного APK.

## Открытый этап

Физический Android-телефон не подключён. До device acceptance нужно установить APK на реальный телефон и проверить вход, бронь, отображение кода, внешние ссылки, сворачивание/возврат, слабую сеть и повторный запуск. Эта проверка не заменяется успешной сборкой.
