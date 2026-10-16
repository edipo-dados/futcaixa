"use server";

import { createClient } from "@/lib/supabase/server";
import {
  changePasswordSchema,
  type ChangePasswordState,
} from "@/lib/validation/account";

/**
 * Server Action da aba "Meu cadastro": o próprio usuário logado troca a sua
 * senha.
 *
 * Usa SEMPRE o cliente de SESSÃO (`createClient().auth.updateUser`) — nunca o
 * service role/Admin API. Assim o usuário só consegue alterar a própria conta
 * (a troca age sobre o usuário dono da sessão/cookie). A entrada é revalidada
 * no servidor com `changePasswordSchema` (nunca confiar só no front) e esta
 * troca voluntária NÃO é registrada em `access_logs` (auditoria é só para
 * login e reset feito pelo presidente).
 */
export async function changeOwnPassword(
  _prevState: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const parsed = changePasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });

  if (!parsed.success) {
    const fieldErrors: Partial<Record<"password" | "confirm", string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === "password" || field === "confirm") {
        fieldErrors[field] ??= issue.message;
      }
    }
    return { status: "error", fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    return {
      status: "error",
      message: "Não foi possível trocar a senha. Tente novamente.",
    };
  }

  return { status: "success", message: "Senha alterada com sucesso." };
}
