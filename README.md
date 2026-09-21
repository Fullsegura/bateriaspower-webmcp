# Buscador IA de Llantas

Next.js consulta el catálogo público actual de PowerLlanta y registra cinco
herramientas WebMCP; Google ADK orquesta la conversación con `gemini-3.8-flash`.

## Requisitos

- Node.js y npm
- Python 3.11–3.13 con `uv`
- Un navegador con WebMCP nativo
- `GEMINI_API_KEY` disponible solo en el proceso server-side

## Catálogo

La aplicación consulta `https://durallanta.com` en cada búsqueda mediante las
rutas same-origin `/api/catalog/search` y `/api/catalog/stock`. Usa
`cache: no-store`, procesa las respuestas en memoria y devuelve como máximo
cinco productos relevantes. No regenera ni usa un catálogo local.

Soporta autos, camionetas/SUV, camiones y motos. Para motos utiliza la única
agrupación de stock `MOTO` reportada por la fuente. Los precios y existencias
son informativos y corresponden al momento de cada consulta.

## Desarrollo local

Terminal 1:

```bash
GEMINI_API_KEY=... uv run uvicorn agent.fast_api_app:app --port 8000
```

Terminal 2:

```bash
npm run dev
```

Abrir `http://localhost:3000/search`. Si ADK usa otra URL, configurar
`ADK_AGENT_URL` en el proceso de Next.

## Validación sin llamadas al modelo

```bash
npm test
npm run test:python
npm run typecheck
npm run lint
npm run build
```

La cotización es informativa: no crea reservas, pedidos, cobros ni efectos externos. No
existe fallback MCP para navegadores sin WebMCP.

## Handoff autónomo por voz

Este challenge no depende de Fullsegura. El cliente usa `/search` y el asesor usa `/advisor`; ambos comparten contexto y una sala LiveKit Cloud.

1. Copia `.env.example` a `.env.local`.
2. Configura `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` y `ADVISOR_ACCESS_TOKEN`.
3. Configura en LiveKit Cloud el webhook público `/api/handoff/livekit/webhook`.
4. Ejecuta `npm run dev`.

El store de casos es temporal y vive en memoria. Para el challenge, el despliegue debe usar una sola instancia. Reiniciar o escalar el proceso elimina la cola.

## Cloud Run

El challenge se despliega en `fullsegura-55e8c` como un servicio aislado con
tres contenedores: Nginx en el puerto público `8080`, Next.js en
`127.0.0.1:3000` y ADK en `127.0.0.1:8000`. Nginx dirige `/ws/live` a ADK y el
resto a Next.js. La escala automática usa mínimo `0` y máximo `1`; al escalar a
cero se elimina la cola temporal.

```bash
gcloud builds submit \
  --project fullsegura-55e8c \
  --config cloudbuild.yaml \
  --substitutions _REGION=us-east1,_REPOSITORY=bateriaspower,_TAG=v1

TAG=v1 ./scripts/deploy-cloud-run.sh
```

El script requiere una cuenta de servicio `bateriaspower-webmcp` y seis
secretos independientes con prefijo `bateriaspower-`; no crea ni modifica
recursos de los servicios Fullsegura existentes.
