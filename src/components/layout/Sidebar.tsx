"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Crown, Menu, Shield, Trophy, X } from "lucide-react";

import { ClubSwitcher } from "@/components/layout/ClubSwitcher";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { useSession } from "@/components/session/session-provider";
import { Button } from "@/components/ui/button";
import { navItemsForRole, ROLE_LABELS } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * Sidebar lateral da área autenticada (tarefa 23.1 — Requisitos 7.2, 7.5, 18.3).
 *
 * Mobile-first: em telas pequenas é um DRAWER colapsável (botão hambúrguer +
 * overlay) que abre por cima do conteúdo; a partir de `lg` fica FIXA e sempre
 * visível ao lado do conteúdo. Exibe:
 *   - a marca/contexto do clube ativo (nome do futebol);
 *   - os links de navegação filtrados pelo papel do usuário no clube ativo
 *     (presidente vê gestão; tesoureiro vê finanças; jogador vê o básico);
 *   - nome do usuário, papel no clube ativo (rótulo pt-BR) e logout.
 *
 * Estados especiais (Req 7.1):
 *   - "sem futebol" (`hasNoClub`): em vez dos links, um CTA de onboarding;
 *   - "presidente aprovado sem clube" (`presidentApprovedWithoutClub`): CTA
 *     "Criar futebol".
 *
 * Acessibilidade: o botão hambúrguer tem `aria-expanded`/`aria-controls`; o
 * drawer tem `role="dialog"`/`aria-modal`; Esc fecha; o foco vai para o drawer
 * ao abrir e volta ao gatilho ao fechar; o overlay é clicável para fechar.
 *
 * Troca de futebol e plataforma (tarefa 23.2 — Req 7.3/7.4/7.6):
 *   - com UMA só membership ativa, exibe apenas o nome do clube (sem seletor);
 *   - com MAIS DE UMA, exibe o {@link ClubSwitcher} (Server Action grava o
 *     cookie `fc_active_club` e redireciona ao dashboard do novo clube);
 *   - para `system_admin`, exibe a entrada "Administração da plataforma"
 *     (link para `/admin/solicitacoes`), oculta para os demais.
 */
interface SidebarProps {
  /**
   * `true` quando o usuário está "sem futebol" mas já teve a presidência
   * aprovada (`profiles.president_status === "aprovado"`): mostra o CTA
   * "Criar futebol" em vez do onboarding genérico. Resolvido no servidor
   * (o `president_status` não é exposto por `getMembershipSession`).
   */
  presidentApprovedWithoutClub?: boolean;
}

export function Sidebar({
  presidentApprovedWithoutClub = false,
}: SidebarProps) {
  const session = useSession();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const navId = useId();

  // Fecha o drawer ao navegar (a rota mudou), evitando deixá-lo aberto por cima
  // da nova página no mobile.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Esc fecha o drawer e devolve o foco ao gatilho.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Ao abrir, move o foco para dentro do drawer (primeiro elemento focável).
  useEffect(() => {
    if (open) {
      drawerRef.current?.focus();
    }
  }, [open]);

  // Marca como ativo apenas o item de MAIOR prefixo correspondente, para que
  // rotas aninhadas (ex.: /membros/papeis dentro de /membros) não acendam dois
  // itens ao mesmo tempo. Considera os itens de navegação + links extras
  // (administração da plataforma e "ser presidente").
  const candidateHrefs = [
    ...(session.role ? navItemsForRole(session.role) : []).map((i) => i.href),
    "/admin",
    "/ser-presidente",
  ];
  const activeHref = candidateHrefs
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
  const isActive = (href: string) => href === activeHref;

  const displayName = session.fullName?.trim() || "Usuário";
  const roleLabel = session.role ? ROLE_LABELS[session.role] : null;
  const clubName = session.activeClub?.clubName ?? null;

  // Seletor de troca de futebol apenas com mais de uma membership ativa
  // (Req 7.3); com um único clube mantemos só o nome (Req 7.4).
  const showClubSwitcher =
    session.memberships.length > 1 && session.activeClub != null;

  const navItems = session.role ? navItemsForRole(session.role) : [];

  // "Ser presidente": oferecido a quem ainda NÃO é presidente de nenhum futebol
  // e não é admin de plataforma. Permite que um jogador comum solicite o papel
  // de presidente (a página mostra o estado atual do pedido). Fica oculto para
  // quem já administra algum futebol e para o system_admin.
  const isPresidentSomewhere = session.memberships.some(
    (m) => m.role === "presidente",
  );
  const showBecomePresident = !session.isSystemAdmin && !isPresidentSomewhere;

  // Conteúdo interno do painel, reutilizado pelo drawer (mobile) e pela coluna
  // fixa (lg+).
  const panel = (
    <div className="flex h-full flex-col gap-4">
      {/* Marca + contexto do clube ativo. */}
      <div className="flex items-center gap-2 px-2">
        <Trophy className="size-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-base font-semibold leading-tight">FutCaixa</p>
          {/* Com >1 futebol o nome aparece no seletor abaixo; aqui só quando
              há um único clube ativo (sem seletor). */}
          {clubName && !showClubSwitcher ? (
            <p className="truncate text-xs text-muted-foreground">{clubName}</p>
          ) : null}
        </div>
      </div>

      {/* Seletor de troca de futebol (Req 7.3) — só com >1 membership ativa. */}
      {showClubSwitcher ? (
        <ClubSwitcher
          memberships={session.memberships}
          activeClubId={session.activeClub!.clubId}
        />
      ) : null}

      {/* Navegação OU estados especiais de onboarding. */}
      <nav
        id={navId}
        aria-label="Navegação principal"
        className="flex-1 overflow-y-auto"
      >
        {session.hasNoClub ? (
          <SemFutebolCta
            presidentApprovedWithoutClub={presidentApprovedWithoutClub}
          />
        ) : (
          <ul className="grid gap-1">
            {navItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  className={cn(
                    "block rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                    isActive(item.href)
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </nav>

      {/* "Ser presidente": solicitar o papel de presidente (jogador comum). */}
      {showBecomePresident ? (
        <div className="border-t pt-3">
          <Link
            href="/ser-presidente"
            aria-current={isActive("/ser-presidente") ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
              isActive("/ser-presidente")
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground",
            )}
          >
            <Crown className="size-4 shrink-0" aria-hidden="true" />
            Ser presidente
          </Link>
        </div>
      ) : null}

      {/* Entrada de administração da plataforma (Req 7.6) — só system_admin. */}
      {session.isSystemAdmin ? (
        <div className="border-t pt-3">
          <Link
            href="/admin/solicitacoes"
            aria-current={isActive("/admin") ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
              isActive("/admin")
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground",
            )}
          >
            <Shield className="size-4 shrink-0" aria-hidden="true" />
            Administração da plataforma
          </Link>
        </div>
      ) : null}

      {/* Usuário + papel + logout (Req 7.5). */}
      <div className="border-t pt-3">
        <div className="px-2 pb-2">
          <p className="truncate text-sm font-medium">{displayName}</p>
          {roleLabel ? (
            <p className="text-xs text-muted-foreground">{roleLabel}</p>
          ) : (
            <p className="text-xs text-muted-foreground">Sem futebol</p>
          )}
        </div>
        <LogoutButton fullWidth />
      </div>
    </div>
  );

  return (
    <>
      {/* Barra superior apenas no mobile: gatilho do drawer + marca. */}
      <div className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background px-4 lg:hidden">
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Abrir menu de navegação"
          aria-expanded={open}
          aria-controls={navId}
          onClick={() => setOpen(true)}
        >
          <Menu aria-hidden="true" />
        </Button>
        <span className="flex items-center gap-2 font-semibold">
          <Trophy className="size-5 text-primary" aria-hidden="true" />
          FutCaixa
        </span>
      </div>

      {/* Drawer (mobile): overlay + painel deslizante. */}
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Fechar menu de navegação"
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu de navegação"
            tabIndex={-1}
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-background p-4 shadow-lg outline-none"
          >
            <div className="mb-2 flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Fechar menu de navegação"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
            {panel}
          </div>
        </div>
      ) : null}

      {/* Coluna fixa (lg+): sempre visível ao lado do conteúdo. */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r bg-background p-4 lg:flex lg:flex-col">
        {panel}
      </aside>
    </>
  );
}

/**
 * CTA de onboarding exibido na sidebar quando o usuário está "sem futebol".
 * Com a presidência já aprovada, convida a criar o futebol; caso contrário,
 * leva à tela de onboarding (`/sem-futebol`), que oferece solicitar presidência
 * ou abrir um convite.
 */
function SemFutebolCta({
  presidentApprovedWithoutClub,
}: {
  presidentApprovedWithoutClub: boolean;
}) {
  if (presidentApprovedWithoutClub) {
    return (
      <div className="space-y-3 px-2">
        <p className="text-sm text-muted-foreground">
          Sua presidência foi aprovada. Crie seu futebol para começar.
        </p>
        <Button asChild className="w-full">
          <Link href="/criar-futebol">Criar futebol</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 px-2">
      <p className="text-sm text-muted-foreground">
        Você ainda não participa de nenhum futebol.
      </p>
      <Button asChild variant="outline" className="w-full">
        <Link href="/sem-futebol">Começar</Link>
      </Button>
    </div>
  );
}
