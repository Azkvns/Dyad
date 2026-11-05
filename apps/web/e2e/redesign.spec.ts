import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

const me = "11111111-1111-4111-8111-111111111111";
const peer = "22222222-2222-4222-8222-222222222222";
const a = "33333333-3333-4333-8333-333333333333";
const b = "44444444-4444-4444-8444-444444444444";
function message(seq: number, senderId = peer, body = `Сообщение ${seq}: короткий текст для проверки вёрстки.`) {
  return { id: `66666666-6666-4666-8666-${String(seq).padStart(12, "0")}`, seq, senderId, body, createdAt: "2026-11-06T09:30:00.000Z", status: senderId === me ? "read" : null };
}
async function fixture(page: Page) {
  let socket: WebSocketRoute | undefined;
  let blocked = false;
  let reportFail = true;
  let blockFail = true;
  let reportCount = 0;
  const sent: unknown[] = [];
  const dialogs = () => [
    { id: a, peer: { id: peer, username: "pek", online: true }, lastMessage: message(60, me, "До встречи!"), unreadCount: 3, blocked },
    { id: b, peer: { id: "55555555-5555-4555-8555-555555555555", username: "alexander_long_username", online: false }, lastMessage: message(1, peer, "x".repeat(2000)), unreadCount: 0, blocked: false },
  ];
  await page.routeWebSocket("**/ws", ws => {
    socket = ws;
    ws.onMessage(raw => {
      const frame = JSON.parse(String(raw));
      sent.push(frame);
      if (frame.type === "message.send") ws.send(JSON.stringify({ type: "message.ack", dialogId: frame.dialogId, clientMsgId: frame.clientMsgId, message: message(70, me, frame.body) }));
    });
    ws.send(JSON.stringify({ type: "ready" }));
  });
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === "/api/auth/me") return json({ id: me, username: "ada" });
    if (path === "/api/dialogs" && request.method() === "GET") return json(dialogs());
    if (path === "/api/dialogs" && request.method() === "POST") return json({ error: "not_found" }, 404);
    if (path === "/api/blocks" && request.method() === "GET") return json(blocked ? [{ username: "pek" }] : []);
    if (path === "/api/blocks" && request.method() === "POST") {
      if (blockFail) { blockFail = false; return json({ error: "internal" }, 500); }
      blocked = true; return route.fulfill({ status: 204 });
    }
    if (path.startsWith("/api/blocks/") && request.method() === "DELETE") { blocked = false; return route.fulfill({ status: 204 }); }
    if (path === "/api/reports" && request.method() === "GET") return json([]);
    if (path === "/api/reports" && request.method() === "POST") {
      reportCount++;
      if (reportFail) { reportFail = false; return json({ error: "internal" }, 500); }
      return json({ id: "77777777-7777-4777-8777-777777777777", messageId: message(60).id, dialogId: a, peerUsername: "pek", body: "Текст сообщения", reason: "spam", createdAt: "2026-11-06T09:30:00.000Z" }, 201);
    }
    if (path.endsWith("/messages")) {
      if (path.includes(b)) return json({ messages: [], nextBeforeSeq: null });
      return json({ messages: url.searchParams.has("beforeSeq") ? Array.from({ length: 10 }, (_, i) => message(i + 1)) : Array.from({ length: 50 }, (_, i) => message(i + 11, i % 3 ? peer : me)), nextBeforeSeq: url.searchParams.has("beforeSeq") ? null : 11 });
    }
    return json({ error: "not_found" }, 404);
  });
  return {
    sent,
    incoming: async (seq: number) => { await expect.poll(() => !!socket).toBe(true); socket!.send(JSON.stringify({ type: "message.new", dialogId: a, message: message(seq) })); },
    reportCount: () => reportCount,
  };
}

for (const width of [320, 375, 390, 768, 1024, 1440]) {
  test(`layout ${width}: bounded panels, composer, long text and mobile back`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await fixture(page);
    await page.goto(`/dialogs/${a}`);
    await expect(page.getByLabel("Сообщение", { exact: true })).toBeVisible();
    await expect.poll(() => page.locator(".bubble").count()).toBe(50);
    const check = async () => {
      const bounds = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, composer: document.querySelector(".composer")!.getBoundingClientRect().bottom, viewport: innerHeight }));
      expect(bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.height).toBeLessThanOrEqual(bounds.viewport);
      expect(Math.abs(bounds.composer - bounds.viewport)).toBeLessThanOrEqual(1);
    };
    await check();
    await page.getByLabel("Сообщение", { exact: true }).fill("https://example.com/" + "x".repeat(1800));
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    await expect(page.getByLabel("Сообщение", { exact: true })).toHaveValue("");
    await check();
    if (width < 900) {
      await expect(page.getByRole("list", { name: "Диалоги", exact: true })).toBeHidden();
      await page.getByRole("link", { name: "Назад", exact: true }).click();
      await expect(page.getByRole("list", { name: "Диалоги", exact: true })).toBeVisible();
    } else await expect(page.getByRole("list", { name: "Диалоги", exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/dyad-${width}.png` });
  });
}

test("drafts, modal focus, IME, history anchoring and live scroll", async ({ page }) => {
  const f = await fixture(page);
  await page.goto(`/dialogs/${a}`);
  const field = page.getByLabel("Сообщение", { exact: true });
  await field.fill("черновик pek");
  await page.getByRole("link", { name: /alexander_long_username/ }).click();
  await expect(field).toHaveValue("");
  await field.fill("черновик alex");
  await page.getByRole("link", { name: /pek/ }).click();
  await expect(field).toHaveValue("черновик pek");
  await field.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(field).toHaveValue("черновик pek");
  const history = page.locator(".history");
  await expect.poll(() => history.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2);
  await history.evaluate(el => { el.scrollTop = 400; el.dispatchEvent(new Event("scroll")); });
  const top = await history.evaluate(el => el.scrollTop);
  await f.incoming(61);
  await expect(page.getByRole("button", { name: /К последним/ })).toBeVisible();
  expect(await history.evaluate(el => el.scrollTop)).toBe(top);
  const anchor = page.locator(".bubble").nth(5);
  const anchorBefore = (await anchor.boundingBox())!.y;
  await page.getByRole("button", { name: "Раньше", exact: true }).evaluate((el: HTMLButtonElement) => el.click());
  await expect.poll(() => page.locator(".bubble").count()).toBe(61);
  const anchorAfter = (await page.locator(".bubble").nth(15).boundingBox())!.y;
  expect(Math.abs(anchorBefore - anchorAfter)).toBeLessThan(2);
  await page.getByRole("button", { name: /К последним/ }).click();
  await f.incoming(62);
  await expect.poll(() => history.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2);
  await field.press("Enter");
  await expect(field).toHaveValue("");
  await page.getByRole("link", { name: /alexander_long_username/ }).click();
  await expect(field).toHaveValue("черновик alex");
  const create = page.getByRole("button", { name: "Новый диалог", exact: true }).first();
  await create.click();
  await expect(page.getByLabel("логин собеседника")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(create).toBeFocused();
  await create.click();
  await page.getByLabel("логин собеседника").fill("nobody");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toHaveText("Пользователь не найден");
  await expect(page.getByLabel("логин собеседника")).toHaveValue("nobody");
});

test("report and block failures recover; confirmation and app menu work", async ({ page }) => {
  const f = await fixture(page);
  await page.goto(`/dialogs/${a}`);
  await page.getByLabel("Действия сообщения", { exact: true }).last().click();
  await page.getByRole("button", { name: "Пожаловаться", exact: true }).click();
  await page.getByRole("button", { name: "спам", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText("Не получилось");
  await page.getByRole("button", { name: "спам", exact: true }).click();
  await expect(page.getByText("Жалоба отправлена", { exact: true })).toBeVisible();
  expect(f.reportCount()).toBe(2);
  await page.getByLabel("Действия диалога", { exact: true }).click();
  await page.getByRole("button", { name: "Заблокировать", exact: true }).click();
  await expect(page.getByRole("button", { name: "Отмена", exact: true })).toBeFocused();
  await page.getByRole("dialog").getByRole("button", { name: "Заблокировать", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Не получилось");
  await page.getByLabel("Действия диалога", { exact: true }).click();
  await page.getByRole("button", { name: "Заблокировать", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Заблокировать", exact: true }).click();
  await expect(page.getByText("Сообщения недоступны", { exact: true })).toBeVisible();
  await page.getByLabel("Действия диалога", { exact: true }).click();
  await page.getByRole("button", { name: "Разблокировать", exact: true }).click();
  await expect(page.getByLabel("Сообщение", { exact: true })).toBeVisible();
  const menu = page.getByLabel("Меню приложения", { exact: true });
  await menu.click(); await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await menu.click(); await page.getByRole("heading", { name: "Сообщения", exact: true }).click();
  await expect(page.getByRole("link", { name: "Блокировки", exact: true })).toBeHidden();
  await menu.click(); await page.getByRole("link", { name: "Жалобы", exact: true }).click();
  await expect(page.getByText("Жалоб пока нет", { exact: true })).toBeVisible();
});

test("auth at 320px: password reveal, server error and scroll in short viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 360 });
  await page.route("**/api/auth/login", route => route.fulfill({ status: 401, json: { error: "invalid_credentials" } }));
  await page.goto("/login");
  await page.getByLabel("Логин", { exact: true }).fill("ada");
  await page.getByLabel("Пароль", { exact: true }).fill("password1");
  await page.getByRole("button", { name: "Показать пароль", exact: true }).click();
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Неверный логин или пароль");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.getByRole("link", { name: "Регистрация", exact: true }).click();
  await expect(page.getByRole("button", { name: "Зарегистрироваться", exact: true })).toBeVisible();
});
