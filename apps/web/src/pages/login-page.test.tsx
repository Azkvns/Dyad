import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { LoginPage } from "./login-page";

describe("LoginPage", () => {
  it("submits the typed username and password", () => {
    const onSubmit = vi.fn();
    render(
      <MemoryRouter>
        <LoginPage onSubmit={onSubmit} error="Неверный логин или пароль" pending={false} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("Логин"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Пароль"), { target: { value: "password1" } });
    fireEvent.click(screen.getByRole("button", { name: "Войти" }));
    expect(onSubmit).toHaveBeenCalledWith("Ada", "password1");
    expect(screen.getByText("Неверный логин или пароль")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Регистрация" }).getAttribute("href")).toBe("/register");
  });
});
