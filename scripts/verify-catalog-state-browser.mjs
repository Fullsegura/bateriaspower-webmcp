import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = new URL(process.env.CATALOG_TEST_URL ?? "http://localhost:3000");
assert(["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname), "Esta prueba solo debe ejecutarse localmente");
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // Transport shim only. Tool arguments come from the actual local catalog, not an LLM fixture.
  await context.addInitScript(() => {
    const registry = new Map();
    Object.defineProperty(document, "modelContext", { value: {
      registerTool(tool, { signal } = {}) {
        registry.set(tool.name, tool);
        signal?.addEventListener("abort", () => { if (registry.get(tool.name) === tool) registry.delete(tool.name); });
      },
      unregisterTool(name) { registry.delete(name); },
    } });
    window.qaTools = registry;
    window.qaExecute = async (name, input) => {
      const result = await registry.get(name).execute(input);
      return JSON.parse(result.content[0].text);
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/search", baseUrl).href);
  await page.waitForFunction(() => window.qaTools.has("discover_catalog"));
  const fixture = await page.evaluate(async () => {
    const makes = await window.qaExecute("discover_catalog", { productType: "battery", scope: "vehicle_makes" });
    for (const make of makes.options) {
      const apps = await window.qaExecute("discover_catalog", { productType: "battery", scope: "vehicle_applications", makeId: make.id });
      const application = apps.options.find((app) => app.id.length > 160 && app.metadata.yearFrom < app.metadata.yearTo);
      if (!application) continue;
      const criteria = { applicationId: application.id, year: application.metadata.yearFrom };
      const result = await window.qaExecute("search_vehicle_batteries", criteria);
      if (result.ok === false) throw new Error(JSON.stringify(result));
      const battery = result.batteries.find((item) => item.locations.some((local) => local.inventory > 0));
      const location = battery.locations.find((local) => local.inventory > 0);
      const selected = await window.qaExecute("select_battery", { batteryId: battery.id, locationId: location.id });
      const quote = await window.qaExecute("prepare_battery_quote", { batteryId: battery.id, locationId: location.id, quantity: 1 });
      if (selected.ok === false || quote.ok === false) throw new Error("El estado no se sincronizó entre herramientas consecutivas");
      return { application, batteryId: battery.id, locationId: location.id };
    }
    throw new Error("El catálogo no contiene un ID largo que cubra varios años");
  });
  await page.getByRole("button", { name: "Quitar cotización", exact: true }).waitFor();
  const next = await page.evaluate(async (fixture) => window.qaExecute("search_vehicle_batteries", {
    applicationId: fixture.application.id, year: fixture.application.metadata.yearTo,
  }), fixture);
  assert.notEqual(next.ok, false, JSON.stringify(next));
  assert.equal(next.resolvedVehicle.year, fixture.application.metadata.yearTo);
  await page.getByRole("button", { name: "Quitar cotización", exact: true }).waitFor({ state: "detached" });
  assert.equal(await page.getByText("Seleccionada", { exact: true }).count(), 0);
  await page.screenshot({ path: "/tmp/powerauto-context-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/powerauto-context-mobile.png" });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Desbordamiento horizontal móvil");

  await page.evaluate(async (fixture) => window.qaExecute("prepare_battery_quote", {
    batteryId: fixture.batteryId, locationId: fixture.locationId, quantity: 1,
  }), fixture);
  await page.getByRole("button", { name: "Quitar cotización", exact: true }).waitFor();
  await page.route("**/api/catalog/batteries/search", (route) => route.fulfill({
    status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Proveedor no disponible" }),
  }));
  const failed = await page.evaluate(async (fixture) => window.qaExecute("search_vehicle_batteries", {
    applicationId: fixture.application.id, year: fixture.application.metadata.yearFrom,
  }), fixture);
  assert.equal(failed.ok, false);
  await page.getByRole("button", { name: "Quitar cotización", exact: true }).waitFor({ state: "detached" });
  assert.equal(await page.getByText("Seleccionada", { exact: true }).count(), 0);
  const obsolete = await page.evaluate(async (fixture) => window.qaExecute("prepare_battery_quote", {
    batteryId: fixture.batteryId, locationId: fixture.locationId, quantity: 1,
  }), fixture);
  assert.equal(obsolete.ok, false, "Reutilizó un producto invalidado tras el fallo");
  await page.evaluate(() => window.qaExecute("reset_catalog", {}));
  assert.deepEqual(errors, []);
  console.log("PASS: herramientas consecutivas, ID largo, mismo ID para varios años, selección/cotización eliminadas y fallo sin estado obsoleto; desktop/mobile sin desbordamiento.");
} finally { await browser.close(); }
