import { describe, expect, it } from "vitest";

import { formatCatalogOptions } from "@/features/catalog/catalog-context";

describe("opciones ambiguas del catálogo", () => {
  it("enumera cualquier lista para permitir referencias ordinales", () => {
    expect(formatCatalogOptions(["Versión A", "Versión B", "Versión C"]))
      .toBe(" Opciones:\n1. Versión A\n2. Versión B\n3. Versión C");
  });
});
