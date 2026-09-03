"use client";

import { useEffect, useState } from "react";

import { registerBatteryTools } from "@/features/webmcp/register-tools";
import type { CatalogActions } from "@/types/catalog";

export type WebMcpStatus = "checking" | "ready" | "unsupported" | "error";

export function useWebMcp(actions: CatalogActions): WebMcpStatus {
  const [status, setStatus] = useState<WebMcpStatus>("checking");

  useEffect(() => {
    const modelContext = document.modelContext;
    const controller = new AbortController();
    let active = true;

    const registration = modelContext
      ? registerBatteryTools(modelContext, actions, controller.signal)
      : Promise.reject(new Error("unsupported"));

    registration
      .then(() => {
        if (active) setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof Error && error.message === "unsupported") {
          setStatus("unsupported");
          return;
        }
        console.error("WebMCP tool registration failed.", error);
        setStatus("error");
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [actions]);

  return status;
}
