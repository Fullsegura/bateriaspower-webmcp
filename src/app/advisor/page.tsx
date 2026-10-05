import type { Metadata } from "next";

import { AdvisorWorkspace } from "@/features/handoff/advisor-workspace";

export const metadata: Metadata = {
  title: "Asesor | PowerAuto",
  description: "Cola autónoma de handoff por voz para consultas automotrices.",
};

export default function AdvisorPage() {
  return <AdvisorWorkspace />;
}
