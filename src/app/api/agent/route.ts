import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  const agentUrl = process.env.ADK_AGENT_URL ?? "http://127.0.0.1:8000/orchestrate";

  try {
    const payload: unknown = await request.json();
    const response = await fetch(agentUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal,
    });
    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: {
        "content-type":
          response.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "El orquestador ADK excedió 45 segundos."
        : "No fue posible conectar con el orquestador ADK.";
    return NextResponse.json({ detail: message }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
