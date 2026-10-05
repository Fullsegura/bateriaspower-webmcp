import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { loadCatalogRuntime, toolDescriptor, validateToolArguments } from "./eval-catalog-runtime.mjs";
import { requireCurrentAgent } from "./eval-agent-health.mjs";
import { bindCheckoutFixture } from "./eval-checkout-fixture.mjs";

const agentUrl = process.env.ADK_AGENT_URL ?? "http://127.0.0.1:8000/orchestrate";
const health = await requireCurrentAgent(agentUrl);
const scenarios = JSON.parse(await readFile(new URL("../tests/eval/datasets/context-flow-dataset.json", import.meta.url), "utf8"));
const runtime = await loadCatalogRuntime();
const traces = [];
let failures = 0;

try {
  const stateModule = await runtime.load("/src/features/catalog/catalog-state.ts");
  const provenance = await runtime.load("/src/lib/catalog-provenance.ts");
  const discovery = await runtime.load("/src/lib/catalog-discovery.ts");
  const batteryCatalog = await runtime.load("/src/lib/battery-catalog.ts");
  const sessions = await runtime.load("/src/lib/catalog-session.ts");
  // Tire fixtures model provider responses; battery cases use the complete local catalog.
  const vehicles = [{ id: "make:toyota", label: "TOYOTA", model: "RAV4" }, { id: "make:hyundai", label: "HYUNDAI", model: "ACCENT" }];
  const years = [2017, 2018, 2021];
  const tireApplications = vehicles.flatMap((vehicle) => years.map((year) => ({
    id: `tire-application:${vehicle.id}:${year}`,
    label: vehicle.model,
    metadata: { make: vehicle.label, model: vehicle.model, year },
  })));
  const makeTire = (application) => ({
    id: `tire:${application.id}`, code: "fixture", name: "Firestone All Season", brand: "Firestone", brandId: "tire-brand:Firestone",
    category: "02", categoryLabel: "Camionetas y SUV", width: "225", height: "65", rim: "17", size: "225/65R17",
    tread: "All Season", application: "HT", loadDescription: "", speedDescription: "T", details: "Uso en carretera",
    price: { status: "available", listWithoutVat: 114.24, discountPercent: 0, unitWithoutVat: 114.24, ecoValue: 1, vatPercent: 15, unitKnownChargesTotal: 132.53 },
    warehouses: [{ cityId: "UIO", warehouseId: "UIO:1", cityCode: "UIO", warehouseCode: "1", warehouseName: "PONCIANO", quantity: 8 }],
    totalStock: 8, stockDiscrepancy: null, image: null, secondaryImages: [],
  });

  for (const scenario of scenarios) {
    const trace = { id: scenario.id, events: [], problem: null };
    traces.push(trace);
    let state = stateModule.createInitialCatalogState("");
    let currentTurn;
    let firstApplicationId;
    const commit = (action) => { state = stateModule.catalogReducer(state, action); };
    const catalogSession = sessions.requireCatalogSession(new Request("http://eval.local", {
      headers: { "x-catalog-session": sessions.createCatalogSession() },
    }));
    const actions = {
      readBatteryCatalog: async () => {
        const listing = sessions.readSessionBatteryCatalog(catalogSession);
        commit({ type: "battery-catalog-read", listing }); return listing;
      },
      presentBatteryAlternatives: async (listingId, batteryIds) => {
        const batteries = sessions.presentSessionBatteryAlternatives(catalogSession, listingId, batteryIds);
        const result = { batteries, resolvedVehicle: null, queriedAt: new Date().toISOString(), source: "Catálogo local", note: "" };
        commit({ type: "battery-alternatives", result }); return result;
      },
      setQuery: (query) => commit({ type: "set-query", query }),
      discover: async (criteria) => {
        provenance.requireDiscoveryInputs(state.discoveries, criteria);
        let result;
        if (criteria.productType === "battery") result = await discovery.discoverCatalog(criteria);
        else {
          let options;
          if (criteria.scope === "vehicle_makes") options = vehicles.map(({ id, label }) => ({ id, label }));
          else if (criteria.scope === "vehicle_years") options = years.map((year) => ({ id: `year:${year}`, label: String(year), metadata: { year } }));
          else if (criteria.scope === "vehicle_applications") {
            const make = vehicles.find((vehicle) => vehicle.id === criteria.makeId);
            options = tireApplications.filter((app) => app.metadata.make === make?.label && (criteria.year === undefined || app.metadata.year === criteria.year));
          } else if (criteria.scope === "locations") {
            options = [{ id: "UIO", label: "Quito", metadata: { type: "city" } },
              { id: "UIO:1", label: "PONCIANO", metadata: { type: "warehouse", cityId: "UIO" } }];
          } else options = [{ id: "tire-brand:Firestone", label: "Firestone" }];
          result = { productType: "tire", scope: criteria.scope, context: criteria, options, queriedAt: new Date().toISOString() };
        }
        commit({ type: "discovered", result });
        return result;
      },
      searchBatteries: async (criteria) => {
        provenance.requireBatterySearchInputs(state.discoveries, criteria);
        commit({ type: "search-started", productType: "battery" });
        const result = await batteryCatalog.searchVehicleBatteries(criteria);
        commit({ type: "batteries-searched", criteria, result });
        return result;
      },
      search: async (criteria) => {
        provenance.requireTireSearchInputs(state.discoveries, criteria);
        assert.equal(criteria.mode, "vehicle", "Cambió de búsqueda por vehículo a una medida no verificada");
        const application = tireApplications.find((app) => app.id === criteria.applicationId);
        assert(application, "Aplicación ajena al proveedor de prueba");
        commit({ type: "search-started", productType: "tire" });
        const result = {
          tires: application.metadata.year === 2021 ? [] : [makeTire(application)],
          resolvedVehicle: { ...application.metadata, sizes: ["225/65R17"] },
          queriedAt: new Date().toISOString(), source: "Fixture proveedor", note: "",
        };
        commit({ type: "searched", criteria, result });
        return result;
      },
      selectBattery: (id, locationId) => {
        const battery = stateModule.runSelectBattery(state.batteries, id);
        if (locationId) batteryCatalog.requireBatteryLocation(battery, locationId);
        commit({ type: "select-battery", batteryId: id, locationId: locationId ?? null }); return battery;
      },
      selectTire: (id) => {
        const tire = stateModule.runSelectTire(state.tires, id);
        commit({ type: "select", tireId: id }); return tire;
      },
      prepareBatteryQuote: (id, quantity, locationId) => {
        const quote = stateModule.runPrepareBatteryQuote(state.batteries, id, quantity, locationId);
        commit({ type: "battery-quote", quote }); return quote;
      },
      prepareQuote: (id, quantity, mode, warehouseId) => {
        const quote = stateModule.runPrepareQuote(state.tires, id, quantity, mode, warehouseId, state.quote);
        commit({ type: "quote", quote }); return quote;
      },
      summarizeStock: () => { throw new Error("Consulta agregada no solicitada"); },
      reset: () => commit({ type: "reset" }),
      clearQuote: () => commit({ type: "clear-quote" }),
    };
    const unbind = runtime.tires.bindCatalogActions(actions);
    const unbindCheckout = await bindCheckoutFixture(runtime, () => state);
    const messages = [];
    const sessionId = `context-${scenario.id}-${Date.now()}`;
    const assertUnselected = () => {
      assert.equal(state.selectedBatteryId, null, "Seleccionó una batería sin confirmarla en el nuevo contexto");
      assert.equal(state.selectedTireId, null, "Seleccionó una llanta sin confirmarla en el nuevo contexto");
      assert.equal(state.batteryQuote, null, "Conservó o creó una cotización de batería sin confirmación");
      assert.equal(state.quote, null, "Conservó o creó una cotización de llanta sin confirmación");
    };
    try {
      for (const turn of scenario.turns) {
        currentTurn = turn;
        const before = structuredClone(state);
        const eventOffset = trace.events.length;
        messages.push({ id: String(messages.length + 1), role: "user", content: turn.text });
        let toolResult;
        let replied = false;
        for (let step = 0; step < 6; step += 1) {
          const response = await fetch(agentUrl, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId, messages, tools: runtime.tools.map(toolDescriptor), uiState: state, toolResult }),
          });
          const action = await response.json();
          assert(response.ok, JSON.stringify(action));
          trace.events.push({ user: turn.text, action });
          if (action.kind === "message") {
            messages.push({ id: String(messages.length + 1), role: "assistant", content: action.message });
            replied = true;
            break;
          }
          assert.equal(validateToolArguments(action, runtime.tools), null);
          const tool = runtime.tools.find((item) => item.name === action.toolName);
          const result = await tool.execute(action.arguments);
          trace.events.push({ toolName: tool.name, arguments: action.arguments, result, state: structuredClone(state) });
          assert.notEqual(result?.ok, false, JSON.stringify(result));
          if (turn.expect !== "quote" && ["select_tire", "select_battery", "prepare_quote", "prepare_battery_quote"].includes(tool.name)) {
            assert.fail("Confundió el cambio de contexto con confirmación de producto");
          }
          if (tool.name === "reset_catalog") assertUnselected();
          if (tool.name === "search_tires" || tool.name === "search_vehicle_batteries") {
            if (turn.year) assert.equal((state.batteryCriteria ?? state.resolvedVehicle)?.year, turn.year);
            if (turn.reuseApplication) assert.equal(action.arguments.applicationId, firstApplicationId, "Exigió otro ID aunque la aplicación cubre ambos años");
            firstApplicationId ??= action.arguments.applicationId;
            assertUnselected();
          }
          // Same result envelope returned by the browser's WebMCP SDK.
          toolResult = { toolName: tool.name, result: { content: [{ type: "text", text: JSON.stringify(result) }] } };
        }
        assert(replied, "Excedió los seis pasos disponibles en el navegador");
        const events = trace.events.slice(eventOffset);
        if (turn.expect === "missing_year" || turn.expect === "clarification") {
          const allowedReads = turn.expect === "clarification" ? ["read_battery_catalog"] : [];
          assert(!events.some((event) => event.toolName && !allowedReads.includes(event.toolName)), "Llamó herramientas sin obtener el dato faltante");
          if (turn.expect === "missing_year") assert.deepEqual(state, before, "Cambió el estado sin obtener el nuevo contexto");
          if (turn.expect === "clarification") assertUnselected();
          assert(messages.at(-1).content.includes("?"), "No formuló una aclaración");
        } else if (turn.expect === "results") {
          const vehicle = state.batteryCriteria ?? state.resolvedVehicle;
          assert.equal(vehicle?.year, turn.year);
          assert.equal(vehicle?.make, turn.make);
          assert.equal(vehicle?.model, turn.model);
          assert(state.batteries.length + state.tires.length > 0, "No obtuvo productos para el nuevo contexto");
          assertUnselected();
        } else if (turn.expect === "empty") {
          assert.equal(state.batteries.length + state.tires.length, 0, "Mantuvo productos de un contexto anterior");
          if (turn.cleared) assertUnselected();
        } else if (turn.expect === "quote") {
          const quote = scenario.productType === "battery" ? state.batteryQuote : state.quote;
          assert(quote, "No cotizó después de confirmar producto, cantidad y localidad");
          assert.equal(quote.quantity, turn.quantity);
          const product = [...state.batteries, ...state.tires].find((item) => item.id === (quote.batteryId ?? quote.tireId));
          assert.equal(product?.name, turn.product);
        }
      }
      console.log(`PASS  ${scenario.id} (${scenario.turns.length} turnos)`);
    } catch (error) {
      failures += 1;
      trace.problem = { turn: currentTurn?.text, error: error.message };
      console.log(`FAIL  ${scenario.id} [${currentTurn?.text}]: ${error.message}`);
    } finally { unbind(); unbindCheckout(); }
  }
  await mkdir("artifacts/evals", { recursive: true });
  const path = `artifacts/evals/catalog-context-flow-${Date.now()}.json`;
  await writeFile(path, JSON.stringify({ health, traces }, null, 2));
  console.log(`${traces.length - failures}/${traces.length} flujos de contexto aprobados. Traza: ${path}`);
  if (failures) process.exitCode = 1;
} finally { await runtime.close(); }
