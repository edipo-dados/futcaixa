"use client";

import { LogOut } from "lucide-react";

import { signOutAction } from "@/app/(app)/actions";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Botão de logout reutilizável (Requisitos 1.5, 7.5).
 *
 * Encapsula um `<form>` que dispara a Server Action `signOutAction`, a qual
 * encerra a sessão do Supabase e redireciona para a tela de login. O botão
 * é acessível: sempre renderiza um rótulo textual ("Sair") além do ícone, de
 * modo que não dependa apenas do ícone. Pensado para ser consumido pela
 * sidebar (tarefa 23.1), mas utilizável em qualquer lugar da área autenticada.
 */
interface LogoutButtonProps
  extends Pick<ButtonProps, "variant" | "size" | "className"> {
  /** Texto exibido no botão. Padrão: "Sair". */
  label?: string;
  /** Oculta o ícone, mantendo apenas o rótulo textual. */
  hideIcon?: boolean;
  /** Faz o botão ocupar toda a largura disponível (útil na sidebar). */
  fullWidth?: boolean;
}

export function LogoutButton({
  label = "Sair",
  hideIcon = false,
  fullWidth = false,
  variant = "outline",
  size = "sm",
  className,
}: LogoutButtonProps) {
  return (
    <form action={signOutAction} className={cn(fullWidth && "w-full")}>
      <Button
        type="submit"
        variant={variant}
        size={size}
        aria-label={`${label} da conta`}
        className={cn(fullWidth && "w-full", className)}
      >
        {hideIcon ? null : <LogOut aria-hidden="true" />}
        {label}
      </Button>
    </form>
  );
}
