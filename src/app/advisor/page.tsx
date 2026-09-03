import type { Metadata } from "next";

import { AdvisorWorkspace } from "@/features/handoff/advisor-workspace";

export const metadata: Metadata = {
  title: "Asesor | BateríasPower",
  description: "Cola autónoma de handoff por voz de BateríasPower.",
};

export default function AdvisorPage() {
  return <AdvisorWorkspace />;
}
