# Deploy: Vercel + Supabase + Blob

La app **solo** usa Supabase (configuración) y Vercel Blob (knowledge, índice RAG). No hay base de datos ni almacenamiento local persistente.

## Quick path

1. Crear proyecto en [Supabase](https://supabase.com) → copiar `DATABASE_URL` (Transaction pooler, puerto **6543**).
2. Subir el repo a GitHub (privado recomendado).
3. En [Vercel](https://vercel.com): importar repo → añadir **Blob Storage** → configurar variables (ver tabla abajo).
4. Deploy → abrir la URL → Configuración → crear tipo de evaluación y subir knowledge.
5. Migrar config desde SQLite antiguo (opcional, una sola vez): `npm run migrate:config` con `data/evaluador.db` y `DATABASE_URL` en `.env.local`.

## Desarrollo local

Mismas variables que en Vercel (ver [.env.example](../.env.example)):

| Variable | Obligatoria |
|----------|-------------|
| `DATABASE_URL` | Sí |
| `BLOB_READ_WRITE_TOKEN` o `BLOB_STORE_ID` | Sí |
| `BLOB_WEBHOOK_PUBLIC_KEY` | Sí si no hay `BLOB_READ_WRITE_TOKEN` (subida >4,5 MB) |
| `OPENROUTER_API_KEY` | Sí |

```bash
cp .env.example .env.local
# editar .env.local
```

Para usar **exactamente las mismas variables que producción** (recomendado):

```bash
npx vercel link
npx vercel env pull .env.local
npm run check:env   # verifica Supabase + Blob servidor
npm run dev
```

En Vercel con OIDC, `BLOB_STORE_ID` + `BLOB_WEBHOOK_PUBLIC_KEY` bastan en deploy, pero **en local** el SDK también necesita `BLOB_READ_WRITE_TOKEN` o el `VERCEL_OIDC_TOKEN` que trae `vercel env pull`.

## Supabase (Fase 0)

| Campo | Valor |
|-------|--------|
| Project name | `evaluador-innovacion` |
| Connect GitHub | No conectar |
| Enable automatic RLS | Desmarcado |

Connection string: **Project Settings → Database → URI → Transaction** (puerto 6543).

Si la contraseña contiene `&`, codifícala como `%26` en la URL (ej. `&WC&…` → `%26WC%26…`). La app también intenta corregirlo automáticamente al conectar.

## Variables en Vercel

| Variable | Obligatoria |
|----------|-------------|
| `DATABASE_URL` | Sí |
| `BLOB_STORE_ID` o `BLOB_READ_WRITE_TOKEN` | Sí (auto al conectar Blob) |
| `BLOB_WEBHOOK_PUBLIC_KEY` | Sí si no hay `BLOB_READ_WRITE_TOKEN` (subida >4,5 MB) |
| `OPENROUTER_API_KEY` | Sí |
| `NEXT_PUBLIC_APP_URL` | Recomendada |

La API key de OpenRouter solo se configura con `OPENROUTER_API_KEY`. Los modelos por función se guardan desde la UI «Configurar LLM» en Supabase. **Todos los campos son obligatorios**; no hay modelos por defecto en código.

## Plan Vercel

Evaluación y extracción usan hasta 5 minutos (`maxDuration = 300`). En plan **Hobby** los timeouts son mucho menores; para uso en equipo se recomienda **Pro**.

## Acceso

Comparte la URL solo con el equipo. No hay login en la app.

## Migración desde SQLite local (legacy)

Solo si tienes `data/evaluador.db` de una versión anterior:

```bash
# Con data/evaluador.db en tu PC y DATABASE_URL de Supabase en .env.local
npm run migrate:config
```

Luego re-sube los PDFs de knowledge en la app y pulsa **Reindexar RAG**.

## Smoke test

- [ ] Dos personas ven el mismo tipo de evaluación
- [ ] Knowledge indexado (fragmentos > 0)
- [ ] Subir proyecto → extracción → evaluar → PDF
- [ ] Tras cerrar el navegador, la config y knowledge siguen; el informe no (esperado)
