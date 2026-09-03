# BateríasPower Search-to-Sale

## Overview

BateríasPower es un MVP ecommerce para el WebMCP Challenge. Una persona y un agente colaboran sobre la misma interfaz y el mismo estado visible para buscar una batería compatible, seleccionar un producto y preparar una cotización referencial sin crear pedidos, cobros ni efectos externos.

La aplicación usa Next.js con App Router para la UI y un runtime Python Google ADK para la conversación. El root ADK delega cada turno al especialista de catálogo. Las capacidades comerciales reales viven únicamente como herramientas WebMCP nativas registradas en el navegador.

## Example Use Cases

1. “Toyota Corolla 2018 motor 1.8” busca compatibilidades importadas del catálogo Baterías Ecuador y actualiza los resultados visibles.
2. “Muéstrame la opción High Power” selecciona un producto existente y abre su ficha.
3. “Prepara una cotización por dos” genera una cotización visual con el precio exacto del catálogo.
4. Una selección manual actualiza el mismo estado que observa el agente en el siguiente turno.
5. Un navegador sin WebMCP muestra un aviso claro y no ofrece un fallback funcional.

## Architecture and Agents

- `search_to_sale_orchestrator`: root ADK con `tools=[]`; no responde preguntas comerciales y delega cada turno.
- `catalog_agent`: especialista único del dominio de catálogo, compatibilidad, selección y cotización.
- Modelo del root y del subagente: `gemini-3.7-flash`.
- Next.js expone `/api/agent` como límite server-side hacia el runtime ADK local.
- ADK conserva la conversación por `sessionId`; el cliente conserva el estado visible de ecommerce.
- No se usa Gemini Live en este MVP.

## WebMCP Tools

- `search_vehicle_batteries(make, model, year, engine?)`
- `show_battery_results(batteryIds)`
- `select_battery(batteryId)`
- `prepare_quote(batteryId, quantity)`
- `reset_search()`

El cliente descubre los esquemas con `document.modelContext.getTools()`. ADK puede solicitar únicamente una herramienta descubierta. El cliente ejecuta la solicitud exacta mediante `document.modelContext.executeTool()` y devuelve el resultado al mismo ciclo del agente. Next y ADK no implementan una segunda copia de la lógica del catálogo.

## Data Sources and Authentication

- Fuente incluida en el proyecto: `data/bateriasecuador/catalogo.json`, `precios.json` y `public/products/bateriasecuador`.
- La importación autocontenida genera 32 productos con precio y 1.307 aplicaciones cotizables a partir de 2.026 registros fuente; no depende de otra carpeta o repositorio.
- Los precios son referenciales, incluyen 15% de IVA y la fuente indica vigencia desde el 20 de julio de 2023 y posibles cambios.
- Gemini API usa `GEMINI_API_KEY` solo en el runtime server-side.
- No se expone ninguna credencial al navegador ni al repositorio.

## Constraints and Safety Rules

- No crear pedidos, ventas, cobros, pagos ni persistencia comercial.
- No usar PagoPlux ni servicios de producción.
- Root ADK siempre `tools=[]`.
- Sin routing conversacional por regex, keywords, fast paths o postprocesamiento en Next.
- No inventar productos, precios ni compatibilidades.
- Validar IDs, cantidades y resultados antes de modificar el estado visible.
- Sin polyfill, fallback MCP, servidor MCP paralelo ni soporte Safari/iOS.
- No modificar `fullseguraAgentesIA`, `bateriasecuador` ni sistemas de clientes; `webmcp` usa únicamente su copia local del catálogo.

## Success Criteria

- El flujo “Toyota Corolla 2018” devuelve productos compatibles existentes.
- Herramientas y controles manuales reutilizan las mismas funciones de dominio.
- El agente puede actualizar el panel ecommerce y reconocer cambios manuales posteriores.
- `prepare_quote` usa el producto y precio exactos del catálogo.
- Desktop mantiene ecommerce y chat visibles en dos paneles.
- Móvil mantiene ecommerce visible y usa un bottom sheet persistente para el agente.
- Typecheck, lint, build y pruebas deterministas pasan.
- Una evaluación ADK cubre búsqueda válida y rechazo de producto inexistente.

## Edge Cases

- Vehículo sin compatibilidad.
- Año fuera del rango registrado en la fuente.
- Motor omitido o no coincidente.
- Producto o ID inexistente.
- Cantidad inválida.
- Herramienta solicitada no descubierta.
- Respuesta ADK o herramienta malformada.
- WebMCP no disponible.
- `GEMINI_API_KEY` ausente.

## Reference Samples

- `google/adk-samples/python/agents/genmedia-for-commerce`: solo como referencia de estructura `App + Agent + FastAPI`. No se reutilizan su MCP server, dominio, medios, GCP ni infraestructura.
- Arquitectura ADK de `fullseguraAgentesIA`: inspeccionada en solo lectura para conservar root sin herramientas, delegación horizontal y propiedad especializada.
