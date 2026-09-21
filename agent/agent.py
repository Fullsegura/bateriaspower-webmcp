"""Google ADK orchestration for the tire search WebMCP experience."""

from google.adk.agents import Agent
from google.adk.apps import App
from google.adk.models import Gemini
from google.genai import types

from agent.shared_catalog_rules import SHARED_CATALOG_RULES

MODEL_ID = "gemini-3.8-flash"

model = Gemini(
    model=MODEL_ID,
    retry_options=types.HttpRetryOptions(attempts=3),
)

TURN_AGENT_INSTRUCTION = f"""
Eres el especialista de Buscador IA de Llantas.

Recibirás un objeto JSON con mensajes, estado visible de la interfaz, esquemas de
herramientas WebMCP descubiertas y, a veces, el resultado de la herramienta
ejecutada en el navegador.

Responde SIEMPRE con un solo objeto JSON válido, sin Markdown, usando exactamente
uno de estos formatos:
{{"kind":"tool_call","toolName":"nombre_descubierto","arguments":{{}},"message":"opcional"}}
{{"kind":"message","message":"respuesta breve en español"}}

{SHARED_CATALOG_RULES}

Reglas del canal de texto:
- Tras recibir toolResult, decide el siguiente paso o responde al usuario.
- Las tarjetas ya muestran productos, precios y bodegas. Responde en máximo cuatro
  líneas: cantidad encontrada, medida o vehículo resuelto, una recomendación breve
  y la siguiente acción. No vuelvas a enumerar todo el catálogo.
- Cuando necesites una herramienta responde con kind=tool_call. En cualquier otro
  caso responde con kind=message.
""".strip()


catalog_agent = Agent(
    name="catalog_agent",
    model=model,
    description=(
        "Especialista en búsqueda de llantas, stock público y cotizaciones "
        "informativas mediante herramientas WebMCP del navegador."
    ),
    instruction=TURN_AGENT_INSTRUCTION,
    tools=[],
)

root_agent = Agent(
    name="search_to_sale_orchestrator",
    model=model,
    description="Orquestador horizontal del flujo de búsqueda y cotización de llantas.",
    instruction="""
Delega cada solicitud, sin excepción, a catalog_agent.
No resuelvas catálogo, compatibilidad, stock, selección ni cotizaciones por tu cuenta.
No transformes la respuesta del especialista.
""".strip(),
    sub_agents=[catalog_agent],
    tools=[],
)

app = App(root_agent=root_agent, name="agent")
