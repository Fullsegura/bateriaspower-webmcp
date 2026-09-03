import { describe, expect, it, vi } from "vitest";

import { registerBatteryTools } from "@/features/webmcp/register-tools";
import type { CatalogActions } from "@/types/catalog";

describe("herramientas WebMCP", () => {
  it("registra exactamente las cinco herramientas aprobadas", async () => {
    const registered: WebMCP.ModelContextTool[] = [];
    const modelContext = {
      registerTool: vi.fn(async (tool: WebMCP.ModelContextTool) => {
        registered.push(tool);
      }),
    } as unknown as WebMCP.ModelContext;
    const actions: CatalogActions = {
      setQuery: vi.fn(),
      search: vi.fn(() => []),
      showResults: vi.fn(() => []),
      selectBattery: vi.fn(() => ({
        id: "be-48-high-power",
        code: "48 HP",
        family: "High Power" as const,
        name: "High Power 48",
        description: "Batería caja 48 de la línea High Power.",
        capacityAh: 75,
        cca: 600,
        polarity: "D",
        dimensions: "275 × 174 × 190 mm",
        reserveCapacityMinutes: 100,
        price: 199.53,
        image: "/products/bateriasecuador/48.png",
      })),
      prepareQuote: vi.fn(() => ({
        batteryId: "be-48-high-power",
        quantity: 2,
        unitPrice: 199.53,
        total: 399.06,
      })),
      clearQuote: vi.fn(),
      reset: vi.fn(),
    };

    await registerBatteryTools(
      modelContext,
      actions,
      new AbortController().signal,
    );

    expect(registered.map(({ name }) => name)).toEqual([
      "search_vehicle_batteries",
      "show_battery_results",
      "select_battery",
      "prepare_quote",
      "reset_search",
    ]);

    const quoteTool = registered.find(({ name }) => name === "prepare_quote");
    await quoteTool?.execute(
      { batteryId: "be-48-high-power", quantity: 2 },
      { signal: new AbortController().signal },
    );
    expect(actions.prepareQuote).toHaveBeenCalledWith("be-48-high-power", 2);
  });
});
