/**
 * Parsea la respuesta de una API como JSON.
 * Si el servidor devuelve HTML (p. ej. página 500 de Vercel/Next), lanza un error legible
 * en lugar de "Unexpected token '<'".
 */
export async function parseResponseJson<T = unknown>(res: Response): Promise<T> {
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();

  if (!text.trim()) {
    if (!res.ok) throw new Error(`Error del servidor (${res.status})`);
    return undefined as T;
  }

  const looksHtml =
    contentType.includes("text/html") ||
    text.trimStart().startsWith("<!DOCTYPE") ||
    text.trimStart().startsWith("<html");

  if (looksHtml) {
    throw new Error(
      res.ok
        ? "El servidor devolvió HTML en lugar de JSON"
        : `Error del servidor (${res.status}). Las APIs no están respondiendo correctamente; revisa el deploy en Vercel (logs y variables de entorno).`
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      res.ok
        ? "Respuesta inválida del servidor (no es JSON)"
        : `Error del servidor (${res.status}): respuesta no JSON`
    );
  }
}
