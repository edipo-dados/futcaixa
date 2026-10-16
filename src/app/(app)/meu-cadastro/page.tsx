import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getMembershipSession } from "@/lib/auth/membership";

import { ChangePasswordForm } from "./change-password-form";

/**
 * Página "Meu cadastro" (Server Component).
 *
 * Qualquer usuário logado (qualquer papel/membership) pode acessar para trocar
 * a própria senha — por isso NÃO há guard de papel aqui. Útil para quem recebeu
 * uma senha temporária do presidente e deseja definir a sua própria. A troca em
 * si é feita no servidor via `auth.updateUser` (cliente de sessão).
 */
export default async function MeuCadastroPage() {
  const session = await getMembershipSession();
  const greetingName = session?.fullName?.trim();

  return (
    <div className="container max-w-sm py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Meu cadastro</h1>
        <p className="mt-1 text-muted-foreground">
          {greetingName
            ? `Olá, ${greetingName}. Gerencie os dados da sua conta.`
            : "Gerencie os dados da sua conta."}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Trocar senha</CardTitle>
          <CardDescription>
            Defina uma nova senha de acesso. Use ao menos 6 caracteres.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
