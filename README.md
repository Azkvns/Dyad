# Dyad

Мессенджер для двоих. Регистрация по логину и паролю, один личный диалог на пару, текстовые сообщения, живые события по WebSocket, статусы «отправлено / доставлено / прочитано», блокировка и жалоба.

Телефон открывает один адрес. В разработке это Vite на порту 5173, в Docker Compose — процесс Dyad на порту 3000.

## Основа

Ориентир по модели сущностей — [Stoat](https://github.com/revoltchat/backend/) (бывший Revolt): пользователь, личный канал из двух участников, сообщение, сессия и шлюз событий. Исходники Stoat в этот репозиторий не входили. У Dyad свой код: один процесс TypeScript и PostgreSQL.

Своё у Dyad: одна строка диалога на неупорядоченную пару, два курсора (доставка и прочтение), блокировка и жалоба, только текст и только диалог 1:1.

## Стек

- Node.js 22+, pnpm 10
- Fastify, `ws`, Drizzle ORM, PostgreSQL 16
- Zod в `packages/contracts` — схемы тел, кадров и ответов
- bcrypt (cost 12), сессия в cookie `dyad_session`
- React, Vite, Playwright
- Vitest

JSON в camelCase, колонки в snake_case, время в JSON — ISO-8601. Ошибка — `{ "error": "код" }`. Для `validation_error` добавляется `fields`.

## Структура

```text
apps/api              HTTP и WebSocket, сервисы, миграции Drizzle
apps/web              Vite и React
packages/contracts    схемы Zod, общие для сервера и клиента
docker-compose.yml    PostgreSQL и процесс Dyad
docs/                 спецификация
```

Один процесс API — предел продукта: сокеты живут в его памяти. Сервер слушает `0.0.0.0:$PORT` (по умолчанию 3000). Миграции применяются при старте.

## Запуск

Нужны Node.js 22+, pnpm 10.18 и Docker.

Локально API и Vite:

```bash
cp .env.example .env
docker compose up -d postgres
pnpm install
pnpm dev
```

Открыть `http://127.0.0.1:5173`. Vite проксирует `/api` и `/ws` на API.

Один адрес в Docker Compose:

```bash
docker compose up --build
```

Открыть `http://127.0.0.1:3000`. Миграции применяются при старте.

`postgres` — PostgreSQL 16 (`dyad` / `dyad` на порту 5432). При первом создании тома создаётся база `dyad_test`. Для тестов API и Playwright достаточно `docker compose up -d postgres`, чтобы порт 3000 не был занят контейнером Dyad.

Проверка:

```bash
curl -s -X POST http://127.0.0.1:3000/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"username":"ada","password":"password1"}'
```

Ответ `201` и cookie сессии. Повтор того же логина — `409` `username_taken`.

## Тесты

```bash
pnpm test
```

Vitest ходит в `TEST_DATABASE_URL` (`dyad_test`). Файлы тестов идут последовательно. Перед прогоном Postgres должен быть запущен, а база `dyad_test` — создана (это делает `docker/postgres/init.sql` при первой инициализации тома). Сквозной сценарий: `pnpm e2e`.

## HTTP

Префикс `/api`. Без сессии — `401` `unauthorized`, кроме регистрации и входа. Чужой диалог и неизвестный id — `404` `not_found`.

| Метод | Путь | Назначение |
| --- | --- | --- |
| POST | `/api/auth/register` | регистрация, cookie, `201` |
| POST | `/api/auth/login` | вход, cookie |
| POST | `/api/auth/logout` | выход, `204` |
| GET | `/api/auth/me` | текущий пользователь |
| GET | `/api/users/lookup?username=` | поиск по точному логину |
| POST | `/api/dialogs` | открыть или создать диалог по логину |
| GET | `/api/dialogs` | список диалогов |
| GET | `/api/dialogs/:id/messages` | страница истории (`beforeSeq`, `limit`) |
| POST | `/api/dialogs/:id/messages` | отправить текст |
| POST | `/api/dialogs/:id/delivered` | сдвинуть курсор доставки |
| POST | `/api/dialogs/:id/read` | сдвинуть курсор прочтения |
| POST | `/api/blocks` | заблокировать по логину |
| DELETE | `/api/blocks/:username` | снять блок |
| GET | `/api/blocks` | кого заблокировал я |
| POST | `/api/reports` | жалоба на чужое сообщение |
| GET | `/api/reports` | свои жалобы |

Логин: 3–24 символа `[a-z0-9_]`, на входе приводится к нижнему регистру. Пароль: от 8 символов и не длиннее 72 байт UTF-8. Текст сообщения: 1–2000 символов после обрезки краёв. Повтор отправки с тем же `clientMsgId` и тем же текстом возвращает существующее сообщение.

Полные коды ответов, курсоры и статусы — в [спецификации](docs/spec.md).

## WebSocket

Путь `/ws`. Сессия берётся из cookie на рукопожатии. Без сессии сокет закрывается кодом `4401`.

Клиент шлёт `message.send`, `cursor.delivered`, `cursor.read` и `ping` (раз в 25 секунд). Сервер отвечает `ready`, `message.ack`, `message.new`, `cursor.updated`, `presence`, `error` и `pong`. Нет кадров 90 секунд — соединение закрывается.

После обрыва клиент открывает сокет снова и забирает список диалогов и историю по HTTP. Журнала кадров в памяти нет.

## Лицензия

[MIT](LICENSE).
