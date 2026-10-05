import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export async function requireCurrentAgent(agentUrl, { live = false } = {}) {
  const source = await readFile(new URL("../agent/shared_catalog_rules.py", import.meta.url), "utf8");
  const instruction = source.split('SHARED_CATALOG_RULES = """')[1]?.split('""".strip()')[0]?.trim();
  if (!instruction) throw new Error("No se pudo leer la instrucción actual del catálogo.");
  const expected = createHash("sha256").update(instruction).digest("hex");
  const healthUrl = new URL("/health/runtime", agentUrl);
  const response = await fetch(healthUrl);
  const health = await response.json();
  if (!response.ok || health.catalogRulesHash !== expected) {
    throw new Error("El servidor ADK no cargó las instrucciones actuales. Reinícialo antes de ejecutar los evals.");
  }
  if (live) {
    const visualSource = await readFile(new URL("../agent/visual_battery.py", import.meta.url));
    const transportSource = await readFile(new URL("../agent/fast_api_app.py", import.meta.url));
    const liveSource = await readFile(new URL("../agent/live_agent.py", import.meta.url), "utf8");
    const liveInstruction = liveSource.split('LIVE_AGENT_INSTRUCTION = f"""')[1]?.split('""".strip()')[0]
      ?.replace("{SHARED_CATALOG_RULES}", instruction).trim();
    if (!liveInstruction || health.visualResearchHash !== createHash("sha256").update(visualSource).digest("hex") ||
        health.liveTransportHash !== createHash("sha256").update(transportSource).digest("hex") ||
        health.liveRulesHash !== createHash("sha256").update(liveInstruction).digest("hex")) {
      throw new Error("ADK no cargó la investigación visual o las instrucciones Live actuales. Reinícialo.");
    }
  }
  return health;
}
