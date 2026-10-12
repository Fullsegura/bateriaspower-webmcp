import { NextResponse } from "next/server";

export function proxy() {
  const response = NextResponse.next();
  const originTrialToken = process.env.ORIGIN_TRIAL?.trim();

  if (originTrialToken) {
    response.headers.set("Origin-Trial", originTrialToken);
  }

  return response;
}

export const config = {
  matcher: ["/", "/search/:path*", "/advisor/:path*"],
};
