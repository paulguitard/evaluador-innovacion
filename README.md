# Evaluador de Innovación

Aplicación tipo agente-chat que evalúa proyectos usando documentación y rúbricas, con IA (OpenRouter). Incluye chat con streaming, informe de evaluación en tiempo real, RAG sobre documentos de referencia y exportación a PDF.

## Requisitos

- Node.js 18+
- Cuenta en [OpenRouter](https://openrouter.ai/)
- Proyecto en [Supabase](https://supabase.com) (Postgres)
- Almacenamiento [Vercel Blob](https://vercel.com/docs/storage/vercel-blob) (local o en Vercel)

## Instalación

1. Clonar o abrir el proyecto e instalar dependencias:

   ```bash
   npm install
   ```

2. Copiar `.env.example` a `.env.local` y configurar:

   ```
   OPENROUTER_API_KEY=tu_clave
   DATABASE_URL=postgresql://...supabase...:6543/postgres
   BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
   ```

   Para archivos de knowledge mayores de 4,5 MB sin `BLOB_READ_WRITE_TOKEN`, usa `BLOB_STORE_ID` y `BLOB_WEBHOOK_PUBLIC_KEY` (ver [docs/DEPLOY.md](docs/DEPLOY.md)).

3. Arrancar en desarrollo:

   ```bash
   npm run dev
   ```

4. Abrir http://localhost:3000

La configuración (tipos de evaluación, rúbrica, modelos LLM) se guarda en **Supabase**. Los documentos de knowledge y el índice RAG viven en **Vercel Blob**. Los archivos de proyecto de cada sesión son temporales (`/tmp`).

## Uso

- **Header**: Seleccionar el tipo de evaluación y abrir **Configuración** para crear/editar tipos, subir documentación (knowledge), rúbrica y editar el prompt.
- **Knowledge**: Tras subir un documento, la app indexa el RAG automáticamente. Use **Reindexar RAG** si el índice no se generó. Los archivos se pueden eliminar con el botón ✕.
- **Panel izquierdo**: Chat con el agente, botón **Evaluar** para generar el informe, **Subir archivos** para añadir documentos del proyecto.
- **Panel derecho**: Se muestra el informe de evaluación en streaming; botón **PDF** para descargar.

## Notas

- La aplicación no guarda historial de chats.
- **Chat**: clasifica preguntas (proyecto / rúbrica-config / manual) y usa la pregunta del usuario para buscar en el índice.
- **Evaluación**: analiza cada dimensión de la rúbrica por separado con RAG dedicado y luego fusiona el informe.
- Tras actualizar el indexador, pulse **Reindexar RAG** para regenerar fragmentos con metadatos de página.

## Deploy (Vercel + Supabase + Blob)

Guía completa en [docs/DEPLOY.md](docs/DEPLOY.md).

Migración puntual desde una instalación antigua con SQLite local:

```bash
npm run migrate:config
```
