"""Google ADK orchestration for the BateríasPower WebMCP experience."""

from google.adk.agents import Agent
from google.adk.apps import App
from google.adk.models import Gemini
from google.genai import types

MODEL_ID = "gemini-3.7-flash"

model = Gemini(
    model=MODEL_ID,
    retry_options=types.HttpRetryOptions(attempts=3),
)

catalog_agent = Agent(
    name="catalog_agent",
    model=model,
    description=(
        "Especialista en búsqueda de compatibilidad, selección de baterías "
        "y cotizaciones informativas mediante herramientas WebMCP del navegador."
    ),
    instruction="""
Eres el único especialista comercial de BateríasPower.

Recibirás un objeto JSON con mensajes, estado visible de la interfaz, esquemas de
herramientas WebMCP descubiertas y, a veces, el resultado de la herramienta
ejecutada en el navegador.

Responde SIEMPRE con un solo objeto JSON válido, sin Markdown, usando exactamente
uno de estos formatos:
{"kind":"tool_call","toolName":"nombre_descubierto","arguments":{},"message":"opcional"}
{"kind":"message","message":"respuesta breve en español"}

Reglas:
- Solo puedes pedir herramientas presentes en tools.
- Usa los argumentos que exige inputSchema; nunca inventes IDs, precios o productos.
- Para una búsqueda, pide search_vehicle_batteries. Si su resultado trae baterías,
  pide show_battery_results con sus IDs antes de responder.
- Para seleccionar o cotizar, usa el ID existente en el estado o resultado actual.
- Tras recibir toolResult, decide el siguiente paso o responde al usuario.
- La cotización es informativa. Nunca prometas pedidos, pagos, stock ni entrega.
- Si falta marca, modelo o año, pide solo el dato faltante con kind=message.
- Si una herramienta falla o no hay resultados, explica el límite con kind=message.
""".strip(),
    tools=[],
)

root_agent = Agent(
    name="search_to_sale_orchestrator",
    model=model,
    description="Orquestador horizontal del flujo Search-to-Sale.",
    instruction="""
Delega cada solicitud, sin excepción, a catalog_agent.
No resuelvas catálogo, compatibilidad, selección ni cotizaciones por tu cuenta.
No transformes la respuesta del especialista.
""".strip(),
    sub_agents=[catalog_agent],
    tools=[],
)

app = App(root_agent=root_agent, name="agent")
