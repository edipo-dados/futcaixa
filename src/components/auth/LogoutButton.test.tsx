import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// A Server Action importa clientes Supabase marcados como `server-only`.
// Nos testes (jsdom) substituímos por um stub para focar no comportamento
// do componente: renderizar um botão acessível dentro de um form que aponta
// para a action de logout.
vi.mock("@/app/(app)/actions", () => ({
  signOutAction: vi.fn(),
}));

import { LogoutButton } from "./LogoutButton";

describe("LogoutButton", () => {
  it("renderiza um botão de submit com rótulo textual acessível", () => {
    render(<LogoutButton />);

    const button = screen.getByRole("button", { name: /sair da conta/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("type", "submit");
    // O rótulo textual deve estar presente (não depende apenas do ícone).
    expect(button).toHaveTextContent("Sair");
  });

  it("permite customizar o rótulo", () => {
    render(<LogoutButton label="Encerrar sessão" />);

    const button = screen.getByRole("button", {
      name: /encerrar sessão da conta/i,
    });
    expect(button).toHaveTextContent("Encerrar sessão");
  });

  it("envolve o botão num form que dispara a Server Action de logout", () => {
    const { container } = render(<LogoutButton />);

    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    expect(form).toContainElement(
      screen.getByRole("button", { name: /sair da conta/i }),
    );
  });

  it("mantém o rótulo mesmo quando o ícone é ocultado", () => {
    render(<LogoutButton hideIcon />);

    const button = screen.getByRole("button", { name: /sair da conta/i });
    expect(button).toHaveTextContent("Sair");
    expect(button.querySelector("svg")).toBeNull();
  });
});
