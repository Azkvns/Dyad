import { describe, expect, it } from "vitest";
import { errorText, formatWhen, reasonText, reconnectDelayMs, tickText, unreadBadge } from "./format";

describe("format", () => {
  it("draws the unread badge and the reconnect pause", () => {
    expect(unreadBadge(0)).toBeNull();
    expect(unreadBadge(99)).toBe("99");
    expect(unreadBadge(100)).toBe("99+");
    expect(reconnectDelayMs(1)).toBe(1000);
    expect(reconnectDelayMs(2)).toBe(2000);
    expect(reconnectDelayMs(6)).toBe(30000);
  });

  it("formats clock for today and a short date otherwise", () => {
    const now = new Date("2026-11-05T12:00:00.000Z");
    const today = "2026-11-05T09:30:00.000Z";
    const yesterday = "2026-11-04T09:30:00.000Z";
    expect(formatWhen(today, now)).toBe(
      new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(today)),
    );
    expect(formatWhen(yesterday, now)).toBe(
      new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(yesterday)),
    );
  });

  it("names the three ticks and the Russian errors", () => {
    expect(tickText("sent")).toEqual({ marks: "✓", label: "отправлено" });
    expect(tickText("delivered")).toEqual({ marks: "✓✓", label: "доставлено" });
    expect(tickText("read")).toEqual({ marks: "✓✓", label: "прочитано" });
    expect(tickText(null)).toBeNull();
    expect(errorText(401, { error: "invalid_credentials" })).toBe("Неверный логин или пароль");
    expect(errorText(409, { error: "username_taken" })).toBe("Этот логин занят");
    expect(errorText(404, { error: "not_found" })).toBe("Пользователь не найден");
    expect(errorText(403, { error: "forbidden" })).toBe("Диалог недоступен");
    expect(errorText(409, { error: "already_reported" })).toBe("Жалоба уже отправлена");
    expect(errorText(400, { error: "validation_error", fields: { username: "too_short" } })).toBe(
      "Логин короче 3 символов",
    );
    expect(errorText(400, { error: "validation_error", fields: { password: "too_long" } })).toBe(
      "Пароль длиннее 72 байт",
    );
    expect(reasonText("spam")).toBe("спам");
    expect(reasonText("abuse")).toBe("оскорбление");
    expect(reasonText("other")).toBe("другое");
  });
});
