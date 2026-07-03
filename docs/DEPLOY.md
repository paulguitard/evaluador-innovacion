# Deploy: Vercel + Supabase + Blob

## Quick path

1. Crear proyecto en [Supabase](https://supabase.com) → copiar `DATABASE_URL` (Transaction pooler, puerto **6543**).
2. Subir el repo a GitHub (privado recomendado).
3. En [Vercel](https://vercel.com): importar repo → añadir **Blob Storage** → configurar variables (ver tabla abajo).
4. Deploy → abrir la URL → Configuración → crear tipo de evaluación y subir knowledge.
5. Migrar config local (opcional): `npm run migrate:config` con `DATABASE_URL` apuntando a Supabase.

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
| `OPENROUTER_API_KEY` | Sí |
| `NEXT_PUBLIC_APP_URL` | Recomendada |

En producción no uses `data/llm-config.json`; configura OpenRouter solo por variables de entorno.

## Plan Vercel

Evaluación y extracción usan hasta 5 minutos (`maxDuration = 300`). En plan **Hobby** los timeouts son mucho menores; para uso en equipo se recomienda **Pro**.

## Acceso

Comparte la URL solo con el equipo. No hay login en la app.

## Migración config local

```bash
# Con data/evaluador.db en tu PC y DATABASE_URL de Supabase en .env.local
npm run migrate:config
```

Luego re-sube los PDFs de knowledge en la app desplegada y pulsa **Reindexar RAG** si hace falta.

## Smoke test

- [ ] Dos personas ven el mismo tipo de evaluación
- [ ] Knowledge indexado (fragmentos > 0)
- [ ] Subir proyecto → extracción → evaluar → PDF
- [ ] Tras cerrar el navegador, la config y knowledge siguen; el informe no (esperado)
