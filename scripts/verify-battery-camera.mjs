import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";
import { loadCatalogRuntime, toolDescriptor, validateToolArguments } from "./eval-catalog-runtime.mjs";
import { requireCurrentAgent } from "./eval-agent-health.mjs";
import { bindCheckoutFixture } from "./eval-checkout-fixture.mjs";

const webUrl = process.env.EVAL_WEB_URL ?? "http://127.0.0.1:3000";
const agentUrl = process.env.ADK_AGENT_URL ?? "http://127.0.0.1:8000/orchestrate";
const health = await requireCurrentAgent(agentUrl, { live: true });
const pcm = await readFile(process.env.EVAL_AUDIO_PCM ?? "/tmp/powerauto-battery-eval.pcm");
const imageUrl = process.env.EVAL_IMAGE_URL ?? `${webUrl}/products/bateriasecuador/40.png`;
const expectedCapacity = process.env.EVAL_CAPACITY_AH ?? "45";
const requireWeb = process.env.EVAL_REQUIRE_WEB === "1";
const scenario = process.env.EVAL_CAMERA_SCENARIO
  ? JSON.parse(await readFile(process.env.EVAL_CAMERA_SCENARIO, "utf8"))
  : [{ imageUrl, audioPath: process.env.EVAL_AUDIO_PCM ?? "/tmp/powerauto-battery-eval.pcm", expectedCapacity, requireWeb, requireExactWeb: requireWeb }];
const runtime = await loadCatalogRuntime();
const browser = await chromium.launch({ headless: true });
const trace = { health, events: [], problem: null, findings: [] };
trace.fixture = scenario;
trace.turns = [];
let socket;
let frameTimer;
let silenceTimer;
let sendingSpeech = false;
let unbind;
let unbindCheckout;
try {
  const page = await browser.newPage();
  const loadFrame = async (url) => {
    const imagePage = await browser.newPage();
    try {
      await imagePage.goto(url);
      return await imagePage.evaluate(async () => {
        const image = new Image();
        image.src = location.href;
        await image.decode();
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 960 / Math.max(image.naturalWidth, image.naturalHeight));
        canvas.width = Math.round(image.naturalWidth * scale);
        canvas.height = Math.round(image.naturalHeight * scale);
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.82).split(",")[1];
      });
    } finally { await imagePage.close(); }
  };
  await page.goto(`${webUrl}/products/bateriasecuador/40.png`);
  const credentials = await (await fetch(`${webUrl}/api/live/session`, { method: "POST" })).json();
  trace.sessionId = credentials.sessionId;
  const catalogSession = await (await fetch(`${webUrl}/api/catalog/session`, { method: "POST" })).json();
  const reducer = await runtime.load("/src/features/catalog/catalog-state.ts");
  const batteryCatalog = await runtime.load("/src/lib/battery-catalog.ts");
  let state = reducer.createInitialCatalogState("");
  const commit = (action) => { state = reducer.catalogReducer(state, action); };
  const post = async (path, body) => {
    const response = await fetch(`${webUrl}${path}`, { method: "POST",
      headers: { "content-type": "application/json", "x-catalog-session": catalogSession.sessionId },
      body: JSON.stringify(body) });
    const result = await response.json();
    assert(response.ok, JSON.stringify(result));
    return result;
  };
  unbind = runtime.tires.bindCatalogActions({
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
      if (locationId) batteryCatalog.requireBatteryLocation(battery, locationId);
      commit({ type: "select-battery", batteryId, locationId: locationId ?? null });
      return battery;
    },
    prepareBatteryQuote: (batteryId, quantity, locationId) => {
      const quote = reducer.runPrepareBatteryQuote(state.batteries, batteryId, quantity, locationId);
      commit({ type: "battery-quote", quote }); return quote;
    },
  });
  unbindCheckout = await bindCheckoutFixture(runtime, () => state);
  const tools = runtime.tools;
  const address = new URL(agentUrl);
  address.protocol = address.protocol === "https:" ? "wss:" : "ws:";
  address.pathname = `/ws/live/${credentials.sessionId}`;
  address.search = new URLSearchParams({ token: credentials.token }).toString();
  let ready = false;
  let evidence;
  let failure;
  const send = (message) => page.evaluate((message) => window.evalSocket.send(JSON.stringify(message)), message);
  await page.exposeFunction("evalSocketError", () => { failure = new Error("WebSocket falló"); });
  await page.exposeFunction("evalSocketMessage", async (data) => {
    try {
      const message = JSON.parse(data);
      if (message.timing?.length) trace.events.push({ type: "timing", receivedAtMs: Date.now(), stages: message.timing });
      if (message.type !== "audio" && message.type !== "session_resumption") trace.events.push({ ...message, receivedAtMs: Date.now() });
      if (message.type === "ready") ready = true;
      if (message.type === "error") throw new Error(message.message);
      if (message.type === "visual_evidence") evidence = message.evidence;
      if (message.type === "tool_call") {
        assert.equal(validateToolArguments({ toolName: message.name, arguments: message.args }, tools), null);
        const allowed = scenario.some((turn) => turn.phase === "checkout")
          ? ["read_battery_catalog", "present_battery_alternatives", "select_battery", "prepare_battery_quote", "start_card_checkout"]
          : ["read_battery_catalog", "present_battery_alternatives"];
        assert(allowed.includes(message.name),
          `Acción no solicitada: ${message.name}`);
        const result = await tools.find((tool) => tool.name === message.name).execute(message.args);
        assert.notEqual(result?.ok, false, JSON.stringify(result));
        const finished_at_ms = Date.now();
        trace.events.push({ type: "tool_finished", name: message.name, callId: message.call_id, finishedAtMs: finished_at_ms });
        // Reproduce the serialized WebMCP envelope observed in the real browser.
        const envelope = JSON.stringify({ content: [{ type: "text", text: JSON.stringify(result) }] });
        await send({ type: "tool_response", call_id: message.call_id, epoch: message.epoch, result: envelope, finished_at_ms });
      }
    } catch (error) { failure = error; }
  });
  await page.evaluate(({ address, tools }) => {
    window.evalSocket = new WebSocket(address);
    window.evalSocket.addEventListener("open", () => window.evalSocket.send(JSON.stringify({ type: "init", tools })));
    window.evalSocket.addEventListener("error", () => window.evalSocketError());
    window.evalSocket.addEventListener("message", ({ data }) => window.evalSocketMessage(data));
  }, { address: address.toString(), tools: tools.map(toolDescriptor) });
  socket = page;
  const until = async (check, seconds) => {
    const deadline = Date.now() + seconds * 1000;
    while (!check() && !failure && Date.now() < deadline) await sleep(200);
    if (failure) throw failure;
    assert(check(), "Tiempo de espera agotado");
  };
  await until(() => ready, 20);
  const silence = Buffer.alloc(3200).toString("base64");
  silenceTimer = setInterval(() => {
    if (!sendingSpeech) void send({ type: "audio", data: silence }).catch((error) => { failure = error; });
  }, 100);
  let frame;
  frameTimer = setInterval(() => {
    if (frame) void send({ type: "video", data: frame, mime_type: "image/jpeg" }).catch((error) => { failure = error; });
  }, 1000);
  for (const turn of scenario) {
  if (turn.imageUrl) frame = await loadFrame(turn.imageUrl);
  const previousEvidence = evidence;
  const eventStart = trace.events.length;
  const firstProduct = state.batteries[turn.productIndex ?? 0];
  const turnPcm = turn.audioPath ? await readFile(turn.audioPath) : pcm;
  assert(turnPcm.length > 3200, "El audio sintético está vacío");
  await send({ type: "video", data: frame, mime_type: "image/jpeg" });
  await sleep(1500);
  sendingSpeech = true;
  for (let offset = 0; offset < turnPcm.length; offset += 3200) {
    if (failure) throw failure;
    await send({ type: "audio", data: turnPcm.subarray(offset, offset + 3200).toString("base64") });
    await sleep(100);
  }
  sendingSpeech = false;
  const speechFinishedAtMs = Date.now();
  const presented = () => trace.events.slice(eventStart).some((event) => event.type === "tool_call" && event.name === "present_battery_alternatives");
  if (turn.phase === "checkout") {
    await until(() => trace.events.slice(eventStart).some((event) => event.type === "tool_finished" && event.name === "start_card_checkout"), 90);
    assert(firstProduct, "No había alternativas antes de confirmar el producto");
    assert.equal(state.batteryQuote?.batteryId, firstProduct.id);
    assert.equal(state.batteryQuote?.quantity, turn.quantity);
    assert.equal(state.batteryQuote?.location.fulfillment, turn.fulfillment);
    const events = trace.events.slice(eventStart);
    const quotedAt = events.find((event) => event.type === "tool_finished" && event.name === "prepare_battery_quote")?.finishedAtMs;
    const openedAt = events.find((event) => event.type === "tool_finished" && event.name === "start_card_checkout")?.finishedAtMs;
    assert(quotedAt && openedAt >= quotedAt, "Abrió pago sin cotización previa en este turno");
    trace.turns.push({ phase: "checkout", quote: state.batteryQuote, quoteToCheckoutMs: openedAt - quotedAt, speechToCheckoutMs: openedAt - speechFinishedAtMs, events });
    console.log(`PASS selección → cotización → formulario (${openedAt - quotedAt} ms entre resultados, sin cobro)`);
  } else {
  await until(() => evidence && evidence !== previousEvidence && (turn.expectAlternatives === false || presented()), 150);
  trace.evidence = evidence;
  trace.batteries = state.batteries.map(({ id, name, capacityAh }) => ({ id, name, capacityAh }));
  assert.equal(evidence.sessionId, credentials.sessionId);
  if (turn.expectedCapacity) assert(evidence.specifications.some((spec) => spec.name === "capacityAh" && spec.value.includes(turn.expectedCapacity) && spec.evidence === "image"),
    `La etiqueta dice ${turn.expectedCapacity} Ah; no debe sustituirse por el dato del JSON`);
  if (turn.requireWeb) {
    assert(evidence.sources.length > 0, "La investigación no produjo fuentes web");
  }
  if (turn.requireExactWeb) {
    assert.equal(evidence.identification.status, "identified");
    assert(evidence.sources.length > 0, "La referencia exacta no produjo fuentes web");
    assert(evidence.specifications.some((spec) => spec.evidence === "web" && spec.sourceIds.length > 0),
      "No devolvió especificaciones sustentadas por fuentes web");
  }
  assert.equal(state.selectedBatteryId, null);
  assert.equal(state.batteryQuote, null);
  assert.equal(state.batteryCriteria, null);
  if (previousEvidence) assert.notEqual(evidence.frameId, previousEvidence.frameId, "Reutilizó la imagen de la batería anterior");
  console.log(`PASS cámara → evidencia (${evidence.specifications.length} campos, ${evidence.sources.length} fuentes web) → ${state.batteries.length} alternativas sin vehículo ni selección`);
  }
  await until(() => {
    const events = trace.events.slice(eventStart);
    const completed = Math.max(events.findLastIndex((item) => item.type === "tool_finished"), events.findLastIndex((item) => item.type === "visual_evidence"));
    return events.some((event, index) => index > completed && event.type === "state" && event.state === "IDLE");
  }, 90);
  const events = trace.events.slice(eventStart);
  const completed = Math.max(events.findLastIndex((item) => item.type === "tool_finished"), events.findLastIndex((item) => item.type === "visual_evidence"));
  const closing = events.slice(completed + 1).filter((event) => event.type === "transcript" && event.role === "assistant" && event.final);
  const output = closing.map((event) => event.text).join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").replace(/\s+/g, " ");
  const findings = [];
  for (const fragment of turn.forbiddenPostResultFragments ?? []) {
    if (output.includes(fragment)) findings.push(`Narró trabajo pendiente después del resultado: ${fragment}`);
  }
  if (turn.maxClosingReplies && !(closing.length > 0 && closing.length <= turn.maxClosingReplies)) {
    findings.push(`Esperaba una respuesta de cierre; recibió ${closing.length}`);
  }
  const phase = turn.phase ?? "camera";
  const firstOutput = events.slice(completed + 1).find((event) => event.type === "transcript" && event.role === "assistant");
  const lastResultAt = events[completed]?.finishedAtMs ?? events[completed]?.receivedAtMs;
  const response = {
    closing, findings,
    resultToFirstTranscriptMs: firstOutput ? firstOutput.receivedAtMs - lastResultAt : null,
    resultToFinalTranscriptMs: closing.length ? closing.at(-1).receivedAtMs - lastResultAt : null,
  };
  if (turn.phase !== "checkout") trace.turns.push({ phase, evidence, batteries: trace.batteries, events, response });
  else Object.assign(trace.turns.at(-1), { events, response });
  for (const finding of findings) {
    trace.findings.push({ phase, finding });
    console.error(`FAIL cierre ${phase}: ${finding}`);
  }
  if (!findings.length) console.log(`PASS cierre ${phase}: ${closing.length} respuesta`);
  }
  if (trace.findings.length) {
    trace.problem = `${trace.findings.length} hallazgos conversacionales`;
    process.exitCode = 1;
  }
} catch (error) {
  trace.problem = error.message;
  console.error(`FAIL cámara: ${error.message}`);
  process.exitCode = 1;
} finally {
  clearInterval(frameTimer);
  clearInterval(silenceTimer);
  if (trace.sessionId) {
    try {
      const sessionResponse = await fetch(`${new URL(agentUrl).origin}/apps/search_to_sale_live/users/webmcp-live/sessions/${trace.sessionId}`);
      const session = await sessionResponse.json();
      trace.adkEvents = session.events?.filter((event) => !event.liveSessionResumptionUpdate).map((event) => ({
        ...event,
        ...(event.content ? { content: { ...event.content, parts: event.content.parts?.filter((part) => !part.inlineData) } } : {}),
      }));
    } catch (error) { trace.sessionTraceError = error.message; }
  }
  if (socket) await socket.evaluate(() => {
    if (window.evalSocket?.readyState === WebSocket.OPEN) window.evalSocket.send(JSON.stringify({ type: "close" }));
    window.evalSocket?.close();
  });
  unbind?.();
  unbindCheckout?.();
  await browser.close();
  await runtime.close();
  await mkdir("artifacts/evals", { recursive: true });
  const path = `artifacts/evals/battery-camera-${Date.now()}.json`;
  await writeFile(path, JSON.stringify(trace, null, 2));
  console.log(`Traza: ${path}`);
}
