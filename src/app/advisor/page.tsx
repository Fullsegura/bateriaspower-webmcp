import type { Metadata } from "next";

import { AdvisorWorkspace } from "@/features/handoff/advisor-workspace";

export const metadata: Metadata = {
  title: "Asesor | Buscador IA de Llantas",
  description: "Cola autónoma de handoff por voz para consultas de llantas.",
};

export default function AdvisorPage() {
  return <AdvisorWorkspace />;
}
