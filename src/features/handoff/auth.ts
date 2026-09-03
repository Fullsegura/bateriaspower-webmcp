import { timingSafeEqual } from "node:crypto";

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function getAdvisorAccessToken(): string {
  const configured = process.env.ADVISOR_ACCESS_TOKEN?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("ADVISOR_ACCESS_TOKEN no está configurado.");
  }
  return "bateriaspower-demo";
}

export function isAdvisorAuthorized(request: Request): boolean {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;

  try {
    return safeEqual(authorization.slice(7), getAdvisorAccessToken());
  } catch {
    return false;
  }
}
