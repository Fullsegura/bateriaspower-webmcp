import { handlePaymentRequest } from "@/lib/payments/service";
export const runtime = "nodejs";
export async function POST(request: Request) { return handlePaymentRequest(request, "simulate"); }
