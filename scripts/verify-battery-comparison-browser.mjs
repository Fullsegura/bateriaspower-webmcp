import assert from "node:assert/strict";
import { chromium } from "playwright";

const url = process.env.EVAL_WEB_URL ?? "http://localhost:3000/search";
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript(() => {
      const tools = new Map();
      Object.defineProperty(document, "modelContext", { value: {
        registerTool(tool, { signal } = {}) { tools.set(tool.name, tool); signal?.addEventListener("abort", () => { if (tools.get(tool.name) === tool) tools.delete(tool.name); }); },
        unregisterTool(name) { tools.delete(name); }, getTools() { return [...tools.values()]; },
      } });
      window.qaTools = tools;
      window.qaExecute = async (name, args) => JSON.parse((await tools.get(name).execute(args)).content[0].text);
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => window.qaTools?.has("read_battery_catalog"));
    const execute = async (name, args = {}) => {
      const result = await page.evaluate(({ name, args }) => window.qaExecute(name, args), { name, args });
      assert.notEqual(result?.ok, false, JSON.stringify(result));
      return result;
    };
    const listing = await execute("read_battery_catalog");
    const first = listing.products[0];
    await execute("present_battery_alternatives", { listingId: listing.listingId, batteryIds: [first.id] });
    await page.getByRole("heading", { name: "Baterías para comparar", exact: true }).waitFor();
    await execute("select_battery", { batteryId: first.id });
    const result = await execute("present_battery_alternatives", { listingId: listing.listingId, batteryIds: [first.id] });
    assert.equal(await page.getByText("Seleccionada", { exact: true }).count(), 0);
    await execute("prepare_battery_quote", { batteryId: first.id, quantity: 1, locationId: result.batteries[0].locations[0].id });
    await page.getByLabel("1 producto cotizado", { exact: true }).waitFor();
    const next = await execute("read_battery_catalog");
    assert.equal(await page.getByLabel("1 producto cotizado", { exact: true }).count(), 0);
    const ids = next.products.slice(1, 4).map((product) => product.id);
    await execute("present_battery_alternatives", { listingId: next.listingId, batteryIds: ids });
    await page.getByRole("heading", { name: next.products[1].name, exact: true }).waitFor();
    assert.equal(await page.getByText("Seleccionada", { exact: true }).count(), 0);
    await page.getByRole("heading", { name: "Baterías para comparar", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/powerauto-battery-comparison-${viewport.width}.png`, fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Desbordamiento horizontal");
    assert.deepEqual(errors, []);
    console.log(`PASS ${viewport.width}px: fichas → alternativas → selección → cambio de contexto limpia cotización`);
    await context.close();
  }
} finally { await browser.close(); }
