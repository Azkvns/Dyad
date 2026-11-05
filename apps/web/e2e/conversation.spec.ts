import { expect, test, type Page } from "@playwright/test";

function username(prefix: string): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let suffix = "";
  for (let index = 0; index < 6; index += 1) suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${prefix}${suffix}`;
}

async function register(page: Page, name: string): Promise<void> {
  await page.goto("/register");
  await page.getByLabel("Логин").fill(name);
  await page.getByLabel("Пароль").fill("password1");
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  await expect(page.getByRole("heading", { name: "Сообщения" })).toBeVisible();
}

test("two people exchange a live message", async ({ browser }) => {
  const aliceName = username("a");
  const bobName = username("b");
  const aliceContext = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const bobContext = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();
  await register(alicePage, aliceName);
  await register(bobPage, bobName);

  await alicePage.getByRole("button", { name: "Новый диалог" }).first().click();
  await alicePage.getByLabel("логин собеседника").fill(bobName);
  await alicePage.getByRole("button", { name: "Открыть" }).click();
  await alicePage.getByLabel("Сообщение").fill("привет");
  await alicePage.getByRole("button", { name: "Отправить" }).click();

  await expect(bobPage.getByRole("list", { name: "Диалоги" }).getByText("привет")).toBeVisible();
  await expect(alicePage.getByRole("list", { name: "Сообщения" }).getByLabel("доставлено")).toBeVisible();

  await bobPage.getByRole("link", { name: new RegExp(aliceName) }).click();
  await expect(alicePage.getByRole("list", { name: "Сообщения" }).getByLabel("прочитано")).toBeVisible();

  await alicePage.setViewportSize({ width: 390, height: 800 });
  await expect(alicePage.getByRole("link", { name: "Назад" })).toBeVisible();
  await expect(alicePage.getByRole("list", { name: "Диалоги" })).toBeHidden();
  await alicePage.setViewportSize({ width: 1100, height: 800 });
  await expect(alicePage.getByRole("list", { name: "Диалоги" })).toBeVisible();
  await expect(alicePage.getByLabel("Сообщение")).toBeVisible();

  await bobPage.getByLabel("Действия сообщения", { exact: true }).click();
  await bobPage.getByRole("button", { name: "Пожаловаться" }).click();
  await bobPage.getByRole("button", { name: "спам" }).click();
  await expect(bobPage.getByText("Жалоба отправлена")).toBeVisible();
  await bobPage.getByLabel("Меню приложения", { exact: true }).click();
  await bobPage.getByRole("link", { name: "Жалобы" }).click();
  await expect(bobPage.getByText("привет")).toBeVisible();
  await expect(bobPage.getByText("спам")).toBeVisible();

  await bobPage.getByRole("link", { name: "К диалогам" }).click();
  await bobPage.getByRole("link", { name: new RegExp(aliceName) }).click();
  await bobPage.getByLabel("Действия диалога", { exact: true }).click();
  await bobPage.getByRole("button", { name: "Заблокировать", exact: true }).click();
  await bobPage.getByRole("dialog").getByRole("button", { name: "Заблокировать", exact: true }).click();
  await expect(bobPage.getByText("Сообщения недоступны")).toBeVisible();
  await alicePage.reload();
  await expect(alicePage.getByText("Сообщения недоступны")).toBeVisible();
  await expect(alicePage.getByRole("list", { name: "Сообщения" }).getByText("привет")).toBeVisible();
  await expect(alicePage.getByLabel("Сообщение")).toHaveCount(0);

  await aliceContext.close();
  await bobContext.close();
});
