# Overlay Chat — оверлей-чат для геймеров (Windows)

Полупрозрачное окно поверх игры: друзья, личные сообщения и публичные комнаты по короткому коду.  
Клиент — Electron (безрамочный оверлей), сервер — Node.js + Express + Socket.IO + SQLite.

> **SQLite:** сервер использует встроенный модуль `node:sqlite` (Node.js ≥ 22.5 / 24) — тот же SQLite без native-сборки `better-sqlite3`.

**Все ассеты локальные** (без Google Fonts / внешних CDN), чтобы приложение работало в России без VPN.

## Требования

- Node.js **22.5+** (нужен встроенный `node:sqlite`; рекомендуется 22 LTS / 24)
- Windows 10/11 для клиентского .exe (сборка через electron-builder)
- Для друзей по интернету нужен **доступный сервер** (см. раздел «Хостинг»)

## Структура

```
overlay-chat/
  server/     — API + Socket.IO + SQLite
  client/     — Electron-клиент Windows (русский UI)
  android/    — клиент Android с оверлеем поверх игр
  tests/      — автотесты API и сокетов
```

## Запуск сервера

```bash
cd server
npm install
npm start
```

Сервер слушает `http://localhost:3000` (порт задаётся переменной `PORT`).  
База SQLite создаётся в `server/data/chat.db`.

Переменные окружения (опционально):

- `PORT` — порт (по умолчанию 3000)
- `JWT_SECRET` — секрет подписи JWT (**обязательно смените на проде**)

## Запуск клиента (разработка)

```bash
cd client
npm install
# скопировать socket.io в vendor (локальный бандл, без CDN):
mkdir -p src/vendor && cp node_modules/socket.io-client/dist/socket.io.min.js src/vendor/
npm start
```

### Настройки в клиенте

- **Адрес сервера** — по умолчанию `http://localhost:3000`. Для игры с друзьями укажите URL вашего VPS, например `http://95.x.x.x:3000` или `https://chat.example.ru`.
- **Глобальный хоткей** — по умолчанию **Ctrl+Enter** (`CommandOrControl+Enter`).  
  Обычный Enter **не используется** как глобальный хоткей: он мешал бы играм. Формат — [Electron Accelerator](https://www.electronjs.org/docs/latest/api/accelerator) (документация; сам Electron ставится локально через npm).
- **Прозрачность** окна — ползунок в настройках.

### Режим «замок» (оверлей в игре)

1. Нажмите 🔓 → окно станет поверх всех (`always-on-top` уровень `screen-saver`), перестанет перетаскиваться.
2. Клики мыши **проходят в игру** (`setIgnoreMouseEvents(true, { forward: true })`), **кроме** поля ввода и кнопки замка (при наведении ignore отключается).
3. **Ctrl+Enter** — фокус на поле ввода; после отправки или **Esc** фокус возвращается игре (blur окна).
4. Снова нажмите 🔒 — обычный режим: можно двигать и менять размер.

## Сборка Windows .exe

На машине с Windows (или Linux с wine + electron-builder):

```bash
cd client
npm install
mkdir -p src/vendor && cp node_modules/socket.io-client/dist/socket.io.min.js src/vendor/
npx electron-builder --win
```

Артефакты появятся в `client/dist/`:

- `OverlayChat-Portable-1.0.0.exe` — portable (без установки)
- установщик NSIS (если собран)

На Linux без **wine** часто получается только `win-unpacked/` — упакуйте в zip или соберите `.exe` на Windows.

Готовый архив этой сборки: `client/dist/OverlayChat-Windows-x64.zip` (~111 МБ).

## Автотесты

```bash
# терминал 1
cd server && npm start

# терминал 2
cd tests && npm install && npm test
```

Тесты проверяют регистрацию/вход, друзей, комнаты и realtime-сообщения через HTTP API и Socket.IO.

## Хостинг сервера (важно для России)

Чтобы друзья подключались **без VPN**, сервер должен быть на хосте, доступном из РФ:

| Рекомендуется | Комментарий |
|---------------|-------------|
| **Timeweb**, **Selectel**, **REG.RU**, **Beget**, **FirstVDS** | Российские VPS, обычно стабильно доступны |
| Свой ПК / домашний сервер + белый IP / frp / ngrok-подобные RU | Самохостинг; проброс порта 3000. Cloudflare Tunnel может быть нестабилен из РФ |
| VPS в СНГ / нейтральных локациях | Часто ок, проверьте ping |

| Может быть заблокировано / нестабильно | |
|----------------------------------------|--|
| Некоторые зарубежные облака без RU-роутинга | Проверьте доступ без VPN |
| Сервисы/CDN вроде части Google, Discord API | В этом проекте **не используются** |

Клиент **не тянет** Google Fonts, Discord и прочие заблокированные CDN — шрифты системные, `socket.io` лежит локально в `src/vendor/`.

Пример запуска на VPS:

```bash
# на сервере
cd server && npm install
JWT_SECRET='длинный-случайный-секрет' PORT=3000 npm start
# или через pm2 / systemd
```

В клиенте: Настройки → Адрес сервера → `http://ВАШ_IP:3000`.

Для HTTPS поставьте nginx/caddy с сертификатом Let's Encrypt перед Node.


## Android-клиент

Нативный Kotlin-клиент (`android/`) к **тому же** серверу: те же аккаунты, друзья, ЛС и комнаты по коду.

### Возможности

- Вход / регистрация (ник + пароль), настраиваемый **адрес сервера**
- Плавающий оверлей поверх игр (`SYSTEM_ALERT_WINDOW` / `TYPE_APPLICATION_OVERLAY` + foreground service)
- Полупрозрачное перетаскиваемое окно; кнопка **замок** — касания уходят в игру (`FLAG_NOT_TOUCHABLE`), остаётся маленькая ручка 🔒 для разблокировки
- Ввод сообщения → клавиатура; после отправки клавиатура скрывается
- Без Firebase; системные шрифты; Socket.IO / OkHttp с Maven при сборке (в рантайме нет Google Fonts / CDN)

### Сборка APK

Нужны JDK 17 и Android SDK (cmdline-tools, platform 34, build-tools 34).

```bash
cd android
# local.properties: sdk.dir=/path/to/Android/Sdk
./gradlew assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
# копия: dist/OverlayChat-android-debug.apk
```

Установка: `adb install -r dist/OverlayChat-android-debug.apk`  
При первом запуске оверлея разрешите **«Поверх других окон»**.

На эмуляторе адрес сервера на хосте: `http://10.0.2.2:3000`. На устройстве в той же Wi‑Fi — `http://IP_ПК:3000` или URL VPS из раздела «Хостинг».

### Ограничения Android

- Оверлей зависит от производителя (MIUI/Huawei могут требовать доп. автозапуск/фон)
- Debug-подпись (не Play Store); для релиза нужна своя keystore
- Эмулятор на этой CI-машине не прогонялся (мало RAM); проверены сборка APK и unit-тест + API/Socket сервера (19 тестов)

## API (кратко)

- `POST /api/register` `{ nickname, password }`
- `POST /api/login` `{ nickname, password }`
- `GET /api/me` (Bearer JWT)
- `POST /api/friends/request` `{ nickname }`
- `POST /api/friends/respond` `{ requestId, accept }`
- `GET /api/friends`
- `POST /api/rooms` `{ name }` → `{ id, name, code }`
- `POST /api/rooms/join` `{ code }`
- `GET /api/rooms`
- `GET /api/messages/room/:id` / `GET /api/messages/dm/:friendId`
- Socket: `message:room`, `message:dm`, события `message:new`, `friend:*`

## Ограничения первой версии

- Сервер нужно куда-то вынести для общения через интернет (localhost — только у себя).
- Нет голосового чата, вложений и шифрования E2E.
- Click-through и возврат фокуса лучше всего работают на Windows; на Linux/X11 поведение может отличаться.
- Один инстанс SQLite — для небольшого числа пользователей; для большой нагрузки позже можно заменить на Postgres.
- Android-клиент с оверлеем — в `android/` (первая версия, debug APK). iOS — отдельно.

## Лицензия

MIT
