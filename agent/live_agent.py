"""Per-session Gemini Live agent construction."""

from __future__ import annotations

import os

from google.adk.agents import Agent
from google.adk.apps import App
from google.adk.models import Gemini
from google.adk.runners import Runner
from google.adk.sessions.base_session_service import BaseSessionService
from google.adk.tools import BaseTool
from google.genai import types

from agent.shared_catalog_rules import SHARED_CATALOG_RULES

LIVE_MODEL_ID = "gemini-3.8-live-extended-thinking"

LIVE_AGENT_INSTRUCTION = f"""
Eres el asesor de voz de Buscador IA de Llantas. Conversa en español natural,
breve y claro. Las fichas, precios y bodegas se muestran en la pantalla: resume
oralmente solo lo necesario para que el usuario pueda decidir y dile cuando los
detalles estén visibles.

{SHARED_CATALOG_RULES}

Reglas del canal de voz:
- No leas listas extensas, códigos largos ni todos los datos de las tarjetas.
- Cuando recibas video, úsalo únicamente como evidencia visual actual. Para buscar
  una llanta intenta leer la medida completa impresa en el costado. Si no es
  legible, pide acercar o reorientar la cámara; nunca completes caracteres dudosos.
- No afirmes compatibilidad por la apariencia de la llanta o del vehículo. Antes
  de llamar una herramienta, confirma visualmente o con el usuario todos sus datos
  requeridos y los requisitos condicionales descritos en su contrato.
- Cuando una herramienta complete una acción visual, confirma brevemente el
  resultado y formula únicamente la siguiente pregunta necesaria.
- No describas como completada una búsqueda, selección o cotización hasta recibir
  el resultado de la herramienta correspondiente.
""".strip()


def create_live_agent(tools: list[BaseTool]) -> Agent:
    model = Gemini(
        model=LIVE_MODEL_ID,
        retry_options=types.HttpRetryOptions(attempts=3),
    )
    thinking_level = os.getenv("LIVE_THINKING_LEVEL", "medium")
    return Agent(
        name="catalog_live_agent",
        model=model,
        description="Asesor de voz para búsqueda y cotización informativa de llantas.",
        instruction=LIVE_AGENT_INSTRUCTION,
        tools=tools,
        generate_content_config=types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(thinking_level=thinking_level)
        ),
    )


def create_live_runner(
    tools: list[BaseTool],
    session_service: BaseSessionService,
) -> Runner:
    agent = create_live_agent(tools)
    live_app = App(name="search_to_sale_live", root_agent=agent)
    return Runner(
        app=live_app,
        session_service=session_service,
        auto_create_session=True,
    )
