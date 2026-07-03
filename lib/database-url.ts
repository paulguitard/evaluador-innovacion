/**
 * Normaliza DATABASE_URL cuando la contraseña incluye caracteres especiales sin codificar.
 * Supabase a veces entrega contraseñas con `&`; en URLs eso trunca el password.
 */
export function normalizeDatabaseUrl(raw: string): string {
  const trimmed = raw.trim();
  const m = trimmed.match(/^(postgres(?:ql)?:\/\/)([^:]+):([^@]+)@([\s\S]+)$/i);
  if (!m) return trimmed;

  const [, proto, user, pass, rest] = m;
  if (pass.includes("&") && !pass.includes("%26")) {
    return `${proto}${user}:${encodeURIComponent(pass)}@${rest}`;
  }
  return trimmed;
}
