import { mkdir, readFile, writeFile } from "node:fs/promises";
import { loadCatalogRuntime, toolDescriptor, validateToolArguments } from "./eval-catalog-runtime.mjs";
import { requireCurrentAgent } from "./eval-agent-health.mjs";

const agentUrl = process.env.ADK_AGENT_URL ?? "http://127.0.0.1:8000/orchestrate";
await requireCurrentAgent(agentUrl);
const runtime = await loadCatalogRuntime();
const datasetPaths = [
  "../tests/eval/datasets/vehicle-exactness-dataset.json",
  "../tests/eval/datasets/transaction-exactness-dataset.json",
  "../tests/eval/datasets/battery-exactness-dataset.json",
  "../tests/eval/datasets/advisor-guidance-dataset.json",
  "../tests/eval/datasets/catalog-discovery-dataset.json",
  "../tests/eval/datasets/payment-flow-dataset.json",
  "../tests/eval/datasets/payment-notification-dataset.json",
  "../tests/eval/datasets/battery-comparison-dataset.json",
  "../tests/eval/datasets/visual-evidence-dataset.json",
].map((path) => new URL(path, import.meta.url));
const allEvalCases = (
  await Promise.all(datasetPaths.map(async (path) => JSON.parse(await readFile(path, "utf8"))))
).flatMap((dataset) => dataset.eval_cases);
const requestedCase = process.env.EVAL_CASE_ID?.trim();
const requestedCases = requestedCase?.split(",").map((id) => id.trim());
const evalCases = requestedCase
  ? allEvalCases.filter((evalCase) => requestedCases.includes(evalCase.eval_case_id))
  : allEvalCases;

if (requestedCase && !evalCases.length) {
  throw new Error(`No existe el caso ${requestedCase}.`);
}

function messageText(content) {
  return (content?.parts ?? []).map((part) => part.text ?? "").join("");
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJson(entry)]),
    );
  }
  return value;
}

function evaluate(actual, expected) {
  if (!["message", "tool_call"].includes(actual?.kind)) {
    return "kind inválido";
  }
  if (expected.kind !== actual.kind) {
    return `kind esperado ${expected.kind}, recibido ${actual.kind}`;
  }
  if (expected.toolName !== undefined && expected.toolName !== actual.toolName) {
    return `toolName esperado ${expected.toolName}, recibido ${actual.toolName}`;
  }
  if (
    expected.exactArguments &&
    JSON.stringify(canonicalJson(expected.arguments)) !==
      JSON.stringify(canonicalJson(actual.arguments))
  ) {
    return `argumentos distintos: ${JSON.stringify(actual.arguments)}`;
  }
  if (expected.argumentSubset) {
    const actualArguments = actual.arguments ?? {};
    const missingOrDifferent = Object.entries(expected.arguments ?? {}).some(
      ([key, value]) =>
        JSON.stringify(canonicalJson(actualArguments[key])) !==
        JSON.stringify(canonicalJson(value)),
    );
    if (missingOrDifferent) {
      return `argumentos requeridos distintos: ${JSON.stringify(actual.arguments)}`;
    }
  }

  const message = normalize(actual.message);
  for (const fragment of expected.requiredMessageFragments ?? []) {
    if (!message.includes(normalize(fragment))) {
      return `falta texto requerido: ${fragment}`;
    }
  }
  for (const alternatives of expected.requiredAnyMessageFragments ?? []) {
    if (!alternatives.some((fragment) => message.includes(normalize(fragment)))) {
      return `falta alguna alternativa requerida: ${alternatives.join(" | ")}`;
    }
  }
  for (const fragment of expected.forbiddenMessageFragments ?? []) {
    if (message.includes(normalize(fragment))) {
      return `incluye texto prohibido: ${fragment}`;
    }
  }
  return null;
}

let failures = 0;
const traces = [];
try {
for (const [index, evalCase] of evalCases.entries()) {
  const envelope = evalCase.envelope ?? JSON.parse(messageText(evalCase.prompt));
  const tools = (envelope.tools ?? []).map((fixture) => {
    const tool = runtime.tools.find((item) => item.name === fixture.name);
    if (!tool) throw new Error(`Fixture usa herramienta inexistente: ${fixture.name}`);
    return toolDescriptor(tool);
  });
  const expected = evalCase.expected ?? JSON.parse(messageText(evalCase.reference.response));
  const response = await fetch(agentUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: `vehicle-exactness-${Date.now()}-${index}`,
      ...envelope,
      tools,
    }),
  });

  let actual;
  try {
    actual = await response.json();
  } catch {
    actual = null;
  }

  const problem = response.ok
    ? ((actual?.kind === "tool_call" ? validateToolArguments(actual, tools) : null) ?? evaluate(actual, expected))
    : `HTTP ${response.status}: ${JSON.stringify(actual)}`;
  if (problem) {
    failures += 1;
    console.log(`FAIL  ${evalCase.eval_case_id}: ${problem}`);
    console.log(`      actual: ${JSON.stringify(actual)}`);
  } else {
    console.log(`PASS  ${evalCase.eval_case_id}`);
  }
  traces.push({ id: evalCase.eval_case_id, request: { ...envelope, tools }, actual, expected, problem });
}
console.log(`\n${evalCases.length - failures}/${evalCases.length} casos conversacionales aprobados.`);
if (failures) process.exitCode = 1;
await mkdir("artifacts/evals", { recursive: true });
const tracePath = `artifacts/evals/vehicle-agent-${Date.now()}.json`;
await writeFile(tracePath, JSON.stringify({ agentUrl, traces }, null, 2));
console.log(`Traza: ${tracePath}`);
} finally {
  await runtime.close();
}
