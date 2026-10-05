# PowerAuto

## Overview

PowerAuto permite que una persona y un agente colaboren sobre la misma interfaz
para buscar llantas o baterías, comparar productos, seleccionar una opción y
preparar una cotización informativa. No crea reservas, pedidos ni cobros.

La aplicación usa Next.js App Router para la UI y Google ADK para la
conversación. El root ADK delega cada turno al especialista de catálogo. Las
capacidades comerciales viven como herramientas WebMCP registradas en el
navegador y conectadas al mismo estado visible.

## Example Use Cases

1. “Necesito llantas para Toyota RAV4 2018 en Quito” consulta variantes y
   medidas actuales antes de mostrar productos con precio y stock por local.
2. “Busco 225/65R17, cuatro unidades en Quito” devuelve hasta cinco opciones y
   mantiene separados precio sin IVA y cargos conocidos.
3. “¿Cuántas llantas de moto hay?” consulta la única agrupación `MOTO` sin pedir
   ciudad ni bodega.
4. “Necesito una batería para Chevrolet Sail 2020” busca la aplicación exacta y
   muestra precios y disponibilidad por localidad.
5. Cuando un vehículo tiene aplicaciones distintas de batería, el agente pide
   el motor exacto antes de mostrar compatibilidad.

## Architecture and Agents

- `search_to_sale_orchestrator`: root ADK con `tools=[]`; delega cada turno.
- `catalog_agent`: especialista único para llantas, baterías y cotizaciones.
- Modelos preservados: `gemini-3.8-flash` y
  `gemini-3.8-live-extended-thinking`.
- Next.js expone `/api/agent`, las rutas actuales de llantas y
  `/api/catalog/batteries/search`.
- Las consultas de llantas se procesan en memoria y no persisten una copia.
- Las baterías usan el catálogo JSON aprobado incluido en el proyecto.

## WebMCP Tools

- `discover_catalog(productType, scope, makeId?, year?, category?)`
- `search_tires(mode, applicationId?, ...)`
- `summarize_tire_stock(category, cityId?, warehouseId?)`
- `select_tire(tireId)`
- `prepare_quote(tireId, quantity, quantityMode, warehouseId?)`
- `search_vehicle_batteries(applicationId, year)`
- `select_battery(batteryId, locationId?)`
- `prepare_battery_quote(batteryId, quantity, locationId)`
- `reset_catalog()`
- `request_advisor_handoff()`

Las herramientas se definen con `@nekuda/webmcp-sdk`. El modelo debe obtener
todos los valores requeridos antes de llamar una herramienta. El código valida
esquemas y cálculos, pero no decide la intención del usuario mediante reglas de
palabras clave.

## Catalog Contracts

- Llantas: categorías `01` autos, `02` camionetas/SUV, `03` camiones y `04`
  motos. Precios, IVA, EcoValor y stock por local se mantienen separados.
- Vehículos: el modelo resuelve el lenguaje del usuario contra marcas y
  aplicaciones descubiertas, y luego busca usando el `applicationId` exacto.
- Los IDs solo son válidos si pertenecen a un descubrimiento vigente del mismo
  producto y contexto. Un descubrimiento vigente puede reutilizarse en la sesión.
- Los precios de baterías se presentan directamente desde el catálogo.
- Baterías y llantas muestran inventario reportado por localidad; nunca constituye
  una reserva.

## Constraints and Safety Rules

- No crear pedidos, ventas, reservas, cobros, pagos ni mensajes externos.
- No usar sesiones privadas, carritos, pedidos ni información de clientes de
  proveedores.
- Root ADK siempre `tools=[]`.
- Sin routing conversacional por regex, keywords, fast paths ni fallbacks.
- No inventar productos, precios, stock ni compatibilidad.
- Pedir únicamente los datos requeridos que falten.
- No instalar polyfills ni crear un servidor MCP paralelo.

## Success Criteria

- El modelo distingue llantas y baterías por el significado de la solicitud y
  pregunta cuando el tipo de producto es ambiguo.
- La compatibilidad se apoya únicamente en respuestas verificadas del catálogo.
- Herramientas y controles manuales reutilizan el mismo estado visible.
- El carrito refleja la cantidad cotizada del producto activo.
- Desktop mantiene catálogo y chat; móvil mantiene catálogo y bottom sheet.
- Typecheck, lint, build y pruebas deterministas pasan.
