import { readFile } from "node:fs/promises";

const agentUrl = process.env.ADK_AGENT_URL ?? "http://127.0.0.1:8000/orchestrate";
const datasetPaths = [
  "../tests/eval/datasets/vehicle-exactness-dataset.json",
  "../tests/eval/datasets/transaction-exactness-dataset.json",
].map((path) => new URL(path, import.meta.url));
const evalCases = (
  await Promise.all(datasetPaths.map(async (path) => JSON.parse(await readFile(path, "utf8"))))
).flatMap((dataset) => dataset.eval_cases);

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
  for (const fragment of expected.forbiddenMessageFragments ?? []) {
    if (message.includes(normalize(fragment))) {
      return `incluye texto prohibido: ${fragment}`;
    }
  }
  return null;
}

let failures = 0;
for (const [index, evalCase] of evalCases.entries()) {
  const envelope = JSON.parse(messageText(evalCase.prompt));
  const expected = JSON.parse(messageText(evalCase.reference.response));
  const response = await fetch(agentUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: `vehicle-exactness-${Date.now()}-${index}`,
      ...envelope,
    }),
  });

  let actual;
  try {
    actual = await response.json();
  } catch {
    actual = null;
  }

  const problem = response.ok
    ? evaluate(actual, expected)
    : `HTTP ${response.status}: ${JSON.stringify(actual)}`;
  if (problem) {
    failures += 1;
    console.log(`FAIL  ${evalCase.eval_case_id}: ${problem}`);
  } else {
    console.log(`PASS  ${evalCase.eval_case_id}`);
  }
}

console.log(`\n${evalCases.length - failures}/${evalCases.length} casos conversacionales aprobados.`);
if (failures) process.exitCode = 1;
