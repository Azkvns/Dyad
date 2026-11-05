# Dyad: поведение интерфейса

Визуальная система: [DESIGN.md](DESIGN.md).

## Business-context sources

| Область | Источник | Следствие для UI |
|---|---|---|
| Аутентификация | README.md; packages/contracts/src/username.ts; apps/web/src/api.ts | Существующие сессии и серверная валидация; пароль маскирован, доступно раскрытие |
| Диалоги и история | packages/contracts/src/dialog.ts; message.ts | Только 1:1; точный логин; история по beforeSeq, до 2000 символов |
| Доставка | apps/web/src/live.ts; packages/contracts/src/ws.ts | Сохраняются optimistic updates и курсоры, UI не меняет протокол |
| Блокировка | README.md; packages/contracts/src/block.ts | Подтверждение блокировки; разблокировка без подтверждения |
| Жалобы | packages/contracts/src/report.ts | Только существующие причины spam/abuse/other |
| Удаление, платежи | README.md | Не входят в продукт |

## Canonical UI Resolution

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Form | components/ui.tsx PasswordField; страницы с noValidate | Серверные контракты; DESIGN.md | auth / peer / composer | Vitest + Playwright |
| Scrollbar | apps/web/src/styles.css | DESIGN.md; :root | stable gutter истории | Playwright computed style |
| Toast | Локальный role=status; errors role=alert | Этот контракт | report / inline error | Playwright |
| CRUD | Mailbox + React Router + существующий API | README.md; contracts | открыть диалог / блокировка / жалоба | conversation.spec.ts; redesign.spec.ts |


## Navigation and state

От 900px список и переписка видимы одновременно. Ниже — маршруты /dialogs и /dialogs/:id, возврат ссылкой «Назад». Блокировки и жалобы возвращают в /dialogs. Открытие диалога — окно с автофокусом, Enter отправляет, Escape закрывает; успех ведёт в переписку. Menu приложения закрывается при навигации, Escape и внешнем клике. Disclosure использует нативную модель Tab и Enter/Space, не ARIA menu.

История при открытии внизу. Входящие прокручивают только при расстоянии до низа менее 72px. Иначе позиция сохраняется и доступна кнопка к последним. Страница старых сообщений сохраняет смещение; собственная отправка ведёт вниз. На desktop Enter отправляет, Shift+Enter переносит, IME не отправляет. Coarse pointer оставляет Enter многострочному вводу. Textarea растёт до 144px.

Черновики по id только в памяти Mailbox: переключение не смешивает текст, отправка очищает только текущий. Выход/перезагрузка завершают сессию интерфейса. Черновики не сохраняются в URL/localStorage, дополнительные предупреждения о потере текста не вводятся.

## Async and recovery

Открытие, блокировки, жалобы и пагинация имеют pending, защиту повторного запуска и текст ошибки. Ошибка сохраняет ввод; действие можно повторить. Ошибка загрузки предлагает повторить, не маскируется как пустой список. Поздняя история игнорируется после перехода. Неподтверждённые сообщения и повтор используют существующие clientMsgId. Общий live reducer, сессии и курсоры не меняются.

Перед блокировкой фокус на отмене; имя и последствие указаны в dialog. Жалобы доступны через кнопку ⋯ у входящего сообщения на touch и с клавиатуры. Окна принадлежат native dialog, trap/inert/ Escape реализует браузер; общий компонент восстанавливает фокус. Дополнительные зависимости не нужны.

## Accessibility and verification

Русские названия, видимый focus, живые статусы, семантические ссылки и кнопки; минимальная цель на мобильном около 44px. Один светлый режим, forced-colors и reduced-motion. Матрица ширин: 320,375,390,768,1024,1440. Визуальная клавиатура требует отдельной проверки на устройстве: desktop-эмуляция не доказывает её корректность.
