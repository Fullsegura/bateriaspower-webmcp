import { handlePagoPluxWebhook } from "@/lib/payments/service";
export const runtime = "nodejs";
export async function POST(request: Request) { return handlePagoPluxWebhook(request); }
