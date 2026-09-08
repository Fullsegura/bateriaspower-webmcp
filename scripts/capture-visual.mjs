import { chromium } from "playwright";

const baseUrl = process.env.VISUAL_URL ?? "http://localhost:3000/search";
const chromePath =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function capture(name, viewport, toolCall = null) {
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
  });
  const page = await browser.newPage({
    viewport,
    deviceScaleFactor: 1,
  });

  await page.addInitScript(() => {
    const tools = [];
    const modelContext = {
      async registerTool(tool, options = {}) {
        tools.push(tool);
        options.signal?.addEventListener(
          "abort",
          () => {
            const index = tools.indexOf(tool);
            if (index >= 0) tools.splice(index, 1);
          },
          { once: true },
        );
      },
      async getTools() {
        return tools.map((tool) => ({
          name: tool.name,
          title: tool.title ?? tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
          window,
          origin: location.origin,
        }));
      },
      async executeTool(tool, input, options = {}) {
        const registered = tools.find(({ name }) => name === tool.name);
        if (!registered) throw new Error("Herramienta no registrada.");
        const parsedInput = typeof input === "string" ? JSON.parse(input) : input;
        return registered.execute(parsedInput, {
          signal: options.signal ?? new AbortController().signal,
        });
      },
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return true;
      },
      ontoolchange: null,
    };
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: modelContext,
    });
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Buscar" }).waitFor();
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")].find(
      (item) => item.textContent?.trim() === "Buscar",
    );
    return button && !button.disabled;
  });
  if (toolCall) {
    await page
      .getByRole("textbox", { name: "Describe la llanta que necesitas" })
      .fill("Moto 120/70R17");
    await page.evaluate(async ({ name, input }) => {
      const tools = await document.modelContext.getTools();
      const tool = tools.find((item) => item.name === name);
      if (!tool) throw new Error(`No se registró ${name}.`);
      await document.modelContext.executeTool(tool, input);
    }, toolCall);
    await page.waitForFunction(() => document.body.innerText.includes("Consultado"));
    await page.waitForLoadState("networkidle");
    await page.waitForFunction(() => {
      const image = document.querySelector("article img");
      return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
    });
  }
  await page.screenshot({
    path: `artifacts/screenshots/${name}.png`,
    fullPage: false,
  });

  const layout = await page.evaluate(async () => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    toolCount: (await document.modelContext.getTools()).length,
    webMcpNotice: document.body.innerText.includes(
      "WebMCP nativo no está disponible",
    ),
  }));
  await browser.close();
  return { name, ...layout };
}

const results = [];
results.push(await capture("desktop-playwright", { width: 1440, height: 1100 }));
results.push(await capture("mobile-playwright", { width: 390, height: 844 }));
const sampleSearch = {
  name: "search_tires",
  input: {
    mode: "measure",
    category: "04",
    width: "120",
    height: "70",
    rim: "17",
    quantity: 1,
  },
};
results.push(await capture(
  "desktop-results-playwright",
  { width: 1440, height: 1100 },
  sampleSearch,
));
results.push(await capture(
  "mobile-results-playwright",
  { width: 390, height: 844 },
  sampleSearch,
));
console.log(JSON.stringify(results, null, 2));
