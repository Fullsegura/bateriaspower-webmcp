# Buscador IA de Llantas

## Overview

Buscador IA de Llantas permite que una persona y un agente colaboren sobre la
misma interfaz para consultar el catálogo público actual de Durallanta, revisar
precio y stock, seleccionar una llanta y preparar una cotización informativa.
No crea reservas, pedidos, cobros ni efectos externos.

La aplicación usa Next.js App Router para la UI y un runtime Python Google ADK
para la conversación. El root ADK delega cada turno al especialista de catálogo.
Las capacidades comerciales viven como herramientas WebMCP registradas en el
navegador y conectadas a rutas same-origin de Next.js.

## Example Use Cases

1. “Toyota RAV4 2018 en Quito” resuelve marca, año, variante y medidas mediante
   las consultas públicas usadas por Durallanta; después muestra productos
   vigentes que coinciden exactamente con esas medidas.
2. “Busco 225/65R17, cuatro unidades en Quito” devuelve hasta cinco opciones con
   precio sin IVA, total de cargos conocidos y stock por local.
3. “¿Cuántas llantas de moto hay?” suma automáticamente la única agrupación
   `MOTO` reportada por Durallanta, sin pedir ciudad o bodega.
4. “Cotiza cuatro de la opción Firestone” genera un subtotal informativo con el
   precio actual retornado por la fuente.

## Architecture and Agents

- `search_to_sale_orchestrator`: root ADK con `tools=[]`; delega cada turno.
- `catalog_agent`: especialista único de catálogo, compatibilidad reportada,
  stock, selección y cotización.
- Modelo preservado: `gemini-3.8-flash`.
- Next.js expone `/api/agent` hacia ADK, `/api/catalog/search` para búsquedas y
  `/api/catalog/stock` para agregados.
- Las rutas de catálogo consultan `https://durallanta.com` con `cache: no-store`,
  procesan la respuesta en memoria y devuelven solo resultados relevantes.
- El cliente conserva como máximo cinco productos visibles; no genera ni
  persiste un catálogo local.

## WebMCP Tools

- `search_tires(mode, ...)`
- `summarize_tire_stock(category, city?, warehouse?)`
- `select_tire(tireId)` cuando existen resultados.
- `prepare_quote(tireId, quantity)` cuando existen resultados.
- `reset_tire_search()`

Las herramientas se definen con `@nekuda/webmcp-sdk`. El cliente descubre y
ejecuta las herramientas disponibles en cada estado. Búsqueda y stock son de
solo lectura; selección, cotización y reset cambian únicamente estado local.

## Durallanta Contract

- Categorías: `01` autos, `02` camionetas/SUV, `03` camiones, `04` motos.
- Vehículos: `get_main_search_parameters`, `get_years_by_car_brand`,
  `get_car_models_by_year`, `get_tires_by_car` y `search_products`.
- Catálogo: `get_products`, `search_products` y `search_products_by_brand`.
- El precio mostrado como “+ IVA” usa `precioDescontado`; el total conocido usa
  `precioFinal`. Si el precio base es cero o incoherente se muestra “Precio por
  confirmar”.
- El stock se obtiene de `stock_bodegas`; UIO, GYE y CUE se mantienen por local.
  Motos usa automáticamente la única agrupación `MOTO`.
- Todo stock se describe como reportado al consultar, nunca como reserva.

## Constraints and Safety Rules

- No crear pedidos, ventas, reservas, cobros, pagos ni mensajes externos.
- No usar sesión privada, carrito, pedidos o información de clientes de Durallanta.
- Root ADK siempre `tools=[]`.
- Sin routing conversacional por regex, keywords o fast paths en Next.
- No inventar productos, precios, stock ni compatibilidad.
- Requerir variante exacta cuando Durallanta devuelve más de un modelo posible.
- Filtrar localmente la medida exacta porque una respuesta externa incorrecta no
  debe convertirse en una afirmación de compatibilidad.
- No instalar polyfills ni crear un servidor MCP paralelo.

## Success Criteria

- Consulta real por vehículo devuelve solo medidas reportadas para la variante.
- Consulta por medida cubre las cuatro categorías, incluidas motos.
- Precio, IVA, EcoValor y stock se mantienen separados.
- Una cantidad distribuida entre bodegas se identifica explícitamente.
- Herramientas y controles manuales reutilizan el mismo estado visible.
- Desktop mantiene catálogo y chat; móvil mantiene catálogo y bottom sheet.
- Typecheck, lint, build y pruebas deterministas pasan.
