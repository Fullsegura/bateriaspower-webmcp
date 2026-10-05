import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { loadCatalogRuntime, toolDescriptor, validateToolArguments } from "./eval-catalog-runtime.mjs";
import { requireCurrentAgent } from "./eval-agent-health.mjs";

const agentUrl = process.env.ADK_AGENT_URL ?? "http://127.0.0.1:8000/orchestrate";
const webUrl = process.env.EVAL_WEB_URL ?? "http://127.0.0.1:3000";
const health = await requireCurrentAgent(agentUrl);
const runtime = await loadCatalogRuntime();
const traces = [];
let failures = 0;
try {
  const reducer = await runtime.load("/src/features/catalog/catalog-state.ts");
  for (const capacity of [55, 85]) {
    const trace = { capacity, events: [], problem: null };
    traces.push(trace);
    let state = reducer.createInitialCatalogState("");
    const commit = (action) => { state = reducer.catalogReducer(state, action); };
    const session = await (await fetch(`${webUrl}/api/catalog/session`, { method: "POST" })).json();
    const post = async (path, body) => {
      const response = await fetch(`${webUrl}${path}`, { method: "POST",
        headers: { "content-type": "application/json", "x-catalog-session": session.sessionId }, body: JSON.stringify(body) });
      const data = await response.json();
      assert(response.ok, JSON.stringify(data));
      return data;
    };
    const unbind = runtime.tires.bindCatalogActions({
      readBatteryCatalog: async () => {
        const listing = await post("/api/catalog/batteries/products", {});
        commit({ type: "battery-catalog-read", listing }); return listing;
      },
      presentBatteryAlternatives: async (listingId, batteryIds) => {
        const result = await post("/api/catalog/batteries/alternatives", { listingId, batteryIds });
        commit({ type: "battery-alternatives", result }); return result;
      },
      selectBattery: (batteryId, locationId) => {
        const battery = reducer.runSelectBattery(state.batteries, batteryId);
        commit({ type: "select-battery", batteryId, locationId: locationId ?? null }); return battery;
      },
    });
    const tools = runtime.tools.filter((tool) => ["read_battery_catalog", "present_battery_alternatives", "select_battery", "prepare_battery_quote", "search_vehicle_batteries"].includes(tool.name));
    const messages = [];
    const sessionId = `battery-comparison-${capacity}-${Date.now()}`;
    const turn = async (text, confirmation = false) => {
      messages.push({ id: String(messages.length), role: "user", content: text });
      let toolResult;
      for (let step = 0; step < 6; step++) {
        const response = await fetch(agentUrl, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, messages, uiState: state, tools: tools.map(toolDescriptor), toolResult }) });
        const action = await response.json();
        assert(response.ok, JSON.stringify(action));
        trace.events.push({ action });
        if (action.kind === "message") {
          messages.push({ id: String(messages.length), role: "assistant", content: action.message });
          return;
        }
        assert.equal(validateToolArguments(action, tools), null);
        assert.notEqual(action.toolName, "search_vehicle_batteries", "Exigió vehículo para comparar capacidad");
        assert.notEqual(action.toolName, "prepare_battery_quote", "Cotizó sin cantidad ni localidad");
        if (!confirmation) assert.notEqual(action.toolName, "select_battery", "Seleccionó antes de confirmar");
        const tool = tools.find((tool) => tool.name === action.toolName);
        const result = await tool.execute(action.arguments);
        trace.events.push({ toolName: tool.name, result, state: structuredClone(state) });
        assert.notEqual(result?.ok, false, JSON.stringify(result));
        toolResult = { toolName: tool.name, result: { content: [{ type: "text", text: JSON.stringify(result) }] } };
      }
      assert.fail("No concluyó el turno");
    };
    try {
      state = { ...state, selectedBatteryId: "previous", batteryQuote: { batteryId: "previous" } };
      await turn(`La etiqueta de mi batería dice ${capacity} Ah. Solo compara capacidad y muestra hasta tres opciones parecidas de tu catálogo, sin verificar mi auto. No sé otros datos.`);
      assert(state.batteries.length > 0 && state.batteries.length <= 3);
      assert.equal(state.selectedBatteryId, null);
      assert.equal(state.batteryQuote, null);
      assert.equal(state.batteryCriteria, null);
      for (const battery of state.batteries) assert(Math.abs(battery.capacityAh - capacity) <= 10, "Alternativa alejada de la capacidad solicitada");
      const chosen = state.batteries[0];
      await turn(`Selecciona la ${chosen.name}. Solo seleccionarla por ahora.`, true);
      assert.equal(state.selectedBatteryId, chosen.id);
      assert.equal(state.batteryQuote, null);
      console.log(`PASS capacidad ${capacity} Ah: consulta → alternativas → confirmación`);
    } catch (error) {
      failures++;
      trace.problem = error.message;
      console.log(`FAIL capacidad ${capacity} Ah: ${error.message}`);
    } finally { unbind(); }
  }
  await mkdir("artifacts/evals", { recursive: true });
  const path = `artifacts/evals/battery-comparison-${Date.now()}.json`;
  await writeFile(path, JSON.stringify({ health, traces }, null, 2));
  console.log(`${traces.length - failures}/${traces.length} flujos aprobados. Traza: ${path}`);
  if (failures) process.exitCode = 1;
} finally { await runtime.close(); }
