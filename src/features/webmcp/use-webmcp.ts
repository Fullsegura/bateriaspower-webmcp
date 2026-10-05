"use client";

import { registerTools } from "@nekuda/webmcp-sdk";
import { useEffect, useState } from "react";

import { requestAdvisorHandoffTool } from "@/features/handoff/webmcp-tool";
import { allPaymentTools } from "@/features/payments/webmcp-tools";
import { allBatteryTools } from "@/features/webmcp/tools/batteries";
import { allDiscoveryTools } from "@/features/webmcp/tools/discovery";
import {
  allTireTools,
  bindCatalogActions,
} from "@/features/webmcp/tools/tires";
import type { CatalogActions } from "@/types/catalog";

export type WebMcpStatus = "checking" | "ready" | "unsupported" | "error";

export function useWebMcp(actions: CatalogActions): WebMcpStatus {
  const [status, setStatus] = useState<WebMcpStatus>("checking");

  useEffect(() => {
    let active = true;
    const unbind = bindCatalogActions(actions);
    const registration = registerTools(
      [...allDiscoveryTools, ...allTireTools, ...allBatteryTools, ...allPaymentTools, requestAdvisorHandoffTool],
      { telemetry: false },
    );

    void registration.ready.then((results) => {
      if (!active) return;
      if (results.every(({ state }) => state === "unsupported")) {
        setStatus("unsupported");
      } else if (results.some(({ state }) => state === "failed")) {
        console.error("WebMCP tool registration failed.", results);
        setStatus("error");
      } else {
        setStatus("ready");
      }
    });

    return () => {
      active = false;
      registration.unregister();
      unbind();
    };
  }, [actions]);

  return status;
}
