import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { loadCatalogRuntime, toolDescriptor, validateToolArguments } from "./eval-catalog-runtime.mjs";
import { requireCurrentAgent } from "./eval-agent-health.mjs";
import { bindCheckoutFixture } from "./eval-checkout-fixture.mjs";

const agentUrl = process.env.ADK_AGENT_URL ?? "http://127.0.0.1:8000/orchestrate";
const health = await requireCurrentAgent(agentUrl);
const runtime = await loadCatalogRuntime();
const traces = [];
let failures = 0;

try {
  const stateModule = await runtime.load("/src/features/catalog/catalog-state.ts");
  const provenance = await runtime.load("/src/lib/catalog-provenance.ts");
  const batteryCatalog = await runtime.load("/src/lib/battery-catalog.ts");
  const discovery = await runtime.load("/src/lib/catalog-discovery.ts");
  const scenarios = [
    {
      id: "battery_requested_product_variant_alternative_confirmation",
      productType: "battery",
      initial: "Quiero buscar la batería Mega Power NS40 para mi f150 2014.",
      // Provider-shaped fixtures keep this regression independent of stock changes.
      applicationOptions: [
        { id: "battery-app:1", label: "F-150 · 3.7; 4.6", metadata: { yearFrom: 2010, yearTo: 2018 } },
        { id: "battery-app:2", label: "F-150 · XL; XLT; FX4", metadata: { yearFrom: 2010, yearTo: 2018 } },
      ],
      result: { batteries: [{
        id: "battery-alternative", code: "48 HP", name: "High Power 48", family: "High Power", description: "Batería caja 48",
        capacityAh: 75, cca: 600, reserveCapacityMinutes: 100, price: 199.53,
        polarity: "D", dimensions: "275 x 174 x 190 mm", image: null,
        locations: [{ id: "location:home", location: "A domicilio", inventory: 15 }],
      }], resolvedVehicle: { make: "FORD", model: "F-150", year: 2014, engine: "3.7; 4.6" } },
      confirmation: "Sí, selecciona la High Power 48 y cotiza una a domicilio.",
    },
    {
      id: "tire_requested_product_variant_alternative_confirmation",
      productType: "tire",
      initial: "Quiero llantas SUNFULL SF688 para mi Toyota RAV4 2018.",
      applicationOptions: [
        { id: "tire-app:1", label: "RAV4 CVT AC 2.0 5P 4X2 TA", metadata: { year: 2018 } },
        { id: "tire-app:2", label: "RAV4 LIMITED AC 2.5 5P 4X4 TA", metadata: { year: 2018 } },
      ],
      result: { tires: [{
        id: "tire-alternative", code: "tire-alternative", name: "Firestone All Season", brand: "Firestone", brandId: "tire-brand:Firestone",
        category: "02", categoryLabel: "Camionetas y SUV", width: "225", height: "65", rim: "17", size: "225/65R17",
        tread: "All Season", application: "HT", loadDescription: "", speedDescription: "T", details: "Uso en carretera",
        price: { status: "available", listWithoutVat: 114.24, discountPercent: 0, unitWithoutVat: 114.24, ecoValue: 1, vatPercent: 15, unitKnownChargesTotal: 132.53 },
        warehouses: [{ cityId: "UIO", warehouseId: "UIO:1", cityCode: "UIO", warehouseCode: "1", warehouseName: "PONCIANO", quantity: 8 }],
        totalStock: 8, stockDiscrepancy: null, image: null, secondaryImages: [],
        availability: { scope: "UIO", requestedQuantity: 1, availableUnits: 8, singleWarehouseCanFulfill: true, requiresMultipleWarehouses: false },
      }], resolvedVehicle: { make: "TOYOTA", model: "RAV4 CVT AC 2.0 5P 4X2 TA", year: 2018, sizes: ["225/65R17"] } },
      confirmation: "Sí, selecciona la Firestone All Season y cotiza una en Ponciano.",
    },
  ];

  for (const scenario of scenarios) {
    const trace = { id: scenario.id, events: [], problem: null };
    traces.push(trace);
    let state = stateModule.createInitialCatalogState("");
    const commit = (action) => { state = stateModule.catalogReducer(state, action); };
    let confirmed = false;
    const assertNoPrematureSelection = () => {
      if (!confirmed) {
        assert.equal(state.selectedBatteryId, null, "Seleccionó batería sin confirmación");
        assert.equal(state.selectedTireId, null, "Seleccionó llanta sin confirmación");
        assert.equal(state.batteryQuote, null, "Cotizó batería sin confirmación");
        assert.equal(state.quote, null, "Cotizó llanta sin confirmación");
      }
    };
    const actions = {
      setQuery: (query) => commit({ type: "set-query", query }),
      discover: async (criteria) => {
        provenance.requireDiscoveryInputs(state.discoveries, criteria);
        let result;
        if (criteria.scope === "vehicle_makes") {
          result = { productType: scenario.productType, scope: criteria.scope, context: {}, options: [
            { id: "make:ford", label: "FORD" }, { id: "make:toyota", label: "TOYOTA" },
          ], queriedAt: new Date().toISOString() };
        } else if (criteria.scope === "vehicle_applications") {
          result = { productType: scenario.productType, scope: criteria.scope, context: { makeId: criteria.makeId, year: criteria.year }, options: scenario.applicationOptions, queriedAt: new Date().toISOString() };
        } else {
          result = await discovery.discoverCatalog(criteria);
        }
        commit({ type: "discovered", result });
        return result;
      },
      search: async (criteria) => {
        provenance.requireTireSearchInputs(state.discoveries, criteria);
        commit({ type: "search-started", productType: "tire" });
        const result = { ...scenario.result, queriedAt: new Date().toISOString(), source: "Fixture proveedor", note: "" };
        commit({ type: "searched", criteria, result }); return result;
      },
      searchBatteries: async (criteria) => {
        provenance.requireBatterySearchInputs(state.discoveries, criteria);
        commit({ type: "search-started", productType: "battery" });
        const result = { ...scenario.result, queriedAt: new Date().toISOString(), source: "Fixture proveedor", note: "" };
        commit({ type: "batteries-searched", criteria, result }); return result;
      },
      selectBattery: (batteryId, locationId) => {
        const battery = stateModule.runSelectBattery(state.batteries, batteryId);
        if (locationId) batteryCatalog.requireBatteryLocation(battery, locationId);
        commit({ type: "select-battery", batteryId, locationId: locationId ?? null }); return battery;
      },
      selectTire: (tireId) => {
        const tire = stateModule.runSelectTire(state.tires, tireId);
        commit({ type: "select", tireId }); return tire;
      },
      prepareBatteryQuote: (id, quantity, locationId) => {
        const quote = stateModule.runPrepareBatteryQuote(state.batteries, id, quantity, locationId);
        commit({ type: "battery-quote", quote }); return quote;
      },
      prepareQuote: (id, quantity, mode, warehouseId) => {
        const quote = stateModule.runPrepareQuote(state.tires, id, quantity, mode, warehouseId, state.quote);
        commit({ type: "quote", quote }); return quote;
      },
      summarizeStock: () => { throw new Error("Stock agregado no necesario en este recorrido"); },
      reset: () => { state = stateModule.createInitialCatalogState(""); },
      clearQuote: () => commit({ type: "clear-quote" }),
    };
    const unbind = runtime.tires.bindCatalogActions(actions);
    const unbindCheckout = await bindCheckoutFixture(runtime, () => state);
    const messages = [];
    const sessionId = `flow-${scenario.id}-${Date.now()}`;
    const userTurn = async (content) => {
      messages.push({ id: String(messages.length + 1), role: "user", content });
      let toolResult;
      for (let step = 0; step < 6; step += 1) {
        const response = await fetch(agentUrl, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, messages, tools: runtime.tools.map(toolDescriptor), uiState: state, toolResult }),
        });
        const action = await response.json();
        assert(response.ok, JSON.stringify(action));
        trace.events.push({ user: content, action });
        if (action.kind === "message") {
          assert.doesNotMatch(
            action.message,
            /informativ[oa]s?|referencial(?:es)?|no constituye(?:n)? una reserva|no se crean pedidos ni cobros/i,
            "La respuesta añade advertencias comerciales rutinarias",
          );
          messages.push({ id: String(messages.length + 1), role: "assistant", content: action.message });
          return;
        }
        assert.equal(validateToolArguments(action, runtime.tools), null);
        const tool = runtime.tools.find((item) => item.name === action.toolName);
        const result = await tool.execute(action.arguments);
        trace.events.push({ toolName: tool.name, arguments: action.arguments, result, state: structuredClone(state) });
        assertNoPrematureSelection();
        assert.notEqual(result?.ok, false, JSON.stringify(result));
        toolResult = { toolName: tool.name, result: { content: [{ type: "text", text: JSON.stringify(result) }] } };
      }
      throw new Error("Excedió el máximo de pasos del flujo");
    };
    try {
      await userTurn(scenario.initial);
      assert.equal(state.batteries.length + state.tires.length, 0, "Debe aclarar la aplicación antes de buscar");
      await userTurn("1");
      assertNoPrematureSelection();
      assert.equal(state.batteries.length + state.tires.length, 1, "No buscó la aplicación elegida");
      confirmed = true;
      await userTurn(scenario.confirmation);
      const quote = scenario.productType === "battery" ? state.batteryQuote : state.quote;
      assert(quote, "No preparó la cotización tras confirmar todos los datos");
      assert.equal(quote.quantity, 1);
      console.log(`PASS  ${scenario.id}`);
    } catch (error) {
      failures += 1;
      trace.problem = error.message;
      console.log(`FAIL  ${scenario.id}: ${error.message}`);
    } finally {
      unbind();
      unbindCheckout();
    }
  }
  await mkdir("artifacts/evals", { recursive: true });
  const path = `artifacts/evals/catalog-flow-${Date.now()}.json`;
  await writeFile(path, JSON.stringify({ health, traces }, null, 2));
  console.log(`${traces.length - failures}/${traces.length} flujos con herramientas y estado aprobados. Traza: ${path}`);
  if (failures) process.exitCode = 1;
} finally {
  await runtime.close();
}
