/**
 * Comprueba conexión a Supabase y variables Blob (mismas que producción).
 * Uso: npx tsx scripts/check-cloud-env.ts
 */
import { readFileSync, existsSync } from "fs";
import path from "path";

function loadEnvLocal(): void {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) {
    console.error("Falta .env.local — copia .env.example o ejecuta: vercel env pull .env.local");
    process.exit(1);
  }
  for (const line of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

async function main(): Promise<void> {
  loadEnvLocal();

  const hasDb = !!(process.env.DATABASE_URL || process.env.POSTGRES_URL);
  const hasBlobServer =
    !!process.env.BLOB_READ_WRITE_TOKEN?.trim() ||
    !!(process.env.BLOB_STORE_ID?.trim() && process.env.VERCEL_OIDC_TOKEN?.trim());
  const hasPresigned =
    !!process.env.BLOB_STORE_ID?.trim() && !!process.env.BLOB_WEBHOOK_PUBLIC_KEY?.trim();

  console.log("DATABASE_URL:", hasDb ? "✓" : "✗ FALTA");
  console.log(
    "Blob servidor (list/RAG):",
    hasBlobServer
      ? "✓"
      : "✗ FALTA — añade BLOB_READ_WRITE_TOKEN o `npx vercel env pull .env.local`"
  );
  if (!hasBlobServer && hasPresigned) {
    console.log("Blob presigned (subida cliente): ✓ (BLOB_STORE_ID + BLOB_WEBHOOK_PUBLIC_KEY)");
  }

  if (!hasDb) process.exit(1);

  const { getEvaluationTypesPostgres } = await import("../lib/db-postgres");
  const types = await getEvaluationTypesPostgres();
  console.log(`Tipos en Supabase: ${types.length}`);
  for (const t of types) {
    console.log(`  · ${t.name} (id ${t.id})`);
  }

  if (!hasBlobServer) {
    console.log(
      "\nSin credenciales de servidor Blob no funcionan catálogo, índice RAG ni subidas por API."
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
