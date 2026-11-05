import type { ReportReason } from "contracts";

export function unreadBadge(count: number): string | null {
  if (count <= 0) return null;
  if (count > 99) return "99+";
  return String(count);
}

export function reconnectDelayMs(attempt: number): number {
  const shift = Math.max(0, attempt - 1);
  return Math.min(30_000, 1_000 * 2 ** shift);
}

export function formatWhen(iso: string, now: Date): string {
  const date = new Date(iso);
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(date);
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(date);
}

export function tickText(
  status: "sent" | "delivered" | "read" | null,
): { marks: string; label: string } | null {
  if (status === "sent") return { marks: "✓", label: "отправлено" };
  if (status === "delivered") return { marks: "✓✓", label: "доставлено" };
  if (status === "read") return { marks: "✓✓", label: "прочитано" };
  return null;
}

export function fieldText(field: string, code: string): string {
  if (field === "username" && code === "too_short") return "Логин короче 3 символов";
  if (field === "username" && code === "too_long") return "Логин длиннее 24 символов";
  if (field === "username") return "В логине допустимы только строчные латинские буквы, цифры и знак _";
  if (field === "password" && code === "too_short") return "Пароль короче 8 символов";
  if (field === "password" && code === "too_long") return "Пароль длиннее 72 байт";
  if (field === "body" && code === "too_short") return "Введите текст";
  if (field === "body" && code === "too_long") return "Текст длиннее 2000 символов";
  if (code === "required") return "Заполните поле";
  return "Проверьте поле";
}

export function errorText(status: number, body: { error?: string; fields?: Record<string, string> }): string {
  const first = Object.entries(body.fields ?? {})[0];
  if (body.error === "validation_error" && first) return fieldText(first[0], first[1]);
  if (body.error === "invalid_credentials") return "Неверный логин или пароль";
  if (body.error === "username_taken") return "Этот логин занят";
  if (body.error === "not_found") return "Пользователь не найден";
  if (body.error === "forbidden") return "Диалог недоступен";
  if (body.error === "already_reported") return "Жалоба уже отправлена";
  if (body.error === "conflict") return "Такое сообщение уже отправлено с другим текстом";
  if (status === 500 || body.error === "internal") return "Не получилось выполнить запрос";
  return "Не получилось выполнить запрос";
}

export function reasonText(reason: ReportReason): "спам" | "оскорбление" | "другое" {
  if (reason === "spam") return "спам";
  if (reason === "abuse") return "оскорбление";
  return "другое";
}
