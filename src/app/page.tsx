import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="container flex min-h-dvh flex-col items-center justify-center gap-6 py-12 text-center">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">FutCaixa</h1>
        <p className="max-w-sm text-muted-foreground">
          Caixa transparente para o seu futebol: lançamentos, cobranças via Pix
          e sorteio de times.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button asChild>
          <Link href="/dashboard">Entrar no painel</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/sorteio">Sortear times</Link>
        </Button>
      </div>
    </main>
  );
}
