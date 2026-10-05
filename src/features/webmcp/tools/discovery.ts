import { defineTool } from "@nekuda/webmcp-sdk";

import { withCatalogExecution } from "@/features/webmcp/execution-guard";
import { executeSafely, getCatalogActions } from "@/features/webmcp/tools/tires";
import { parseCatalogDiscoveryCriteria } from "@/lib/catalog-input";

export const discoverCatalogTool = defineTool({
  stableKey: "catalog.discover",
  name: "discover_catalog",
  title: "Descubrir opciones del catálogo",
  description: "Devuelve opciones canónicas con IDs exactos. productType solo acepta tire o battery. vehicle_years requiere makeId descubierto y lista años disponibles; vehicle_applications requiere makeId descubierto, year es opcional para consultar todas las aplicaciones y sus años. Para buscar un vehículo concreto pregunta primero su año si falta. product_brands y locations requieren category para llantas. Solo locations acepta productId (de resultados actuales) y cityId (descubierto en el mismo contexto) para filtrar. Reutiliza respuestas vigentes de uiState.discoveries.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      productType: { type: "string", enum: ["tire", "battery"] },
      scope: {
        type: "string",
        enum: ["vehicle_makes", "vehicle_years", "vehicle_applications", "product_brands", "locations"],
      },
      makeId: { type: "string" },
      year: { type: "integer", minimum: 1900, maximum: 2100 },
      category: { type: "string", enum: ["01", "02", "03", "04"] },
      productId: { type: "string" },
      cityId: { type: "string" },
    },
    required: ["productType", "scope"],
  },
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  intent: "answer",
  async execute(input: Record<string, unknown>) {
    return executeSafely(() => withCatalogExecution((execution) =>
      getCatalogActions().discover(parseCatalogDiscoveryCriteria(input), execution)));
  },
});

export const allDiscoveryTools = [discoverCatalogTool];
