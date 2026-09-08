import type { Quote, Tire } from "@/types/catalog";

export function getTireById(tires: Tire[], id: string): Tire | null {
  return tires.find((tire) => tire.id === id) ?? null;
}

export function requireTire(tires: Tire[], id: string): Tire {
  const tire = getTireById(tires, id);
  if (!tire) throw new Error(`La llanta ${id} no existe en los resultados actuales.`);
  return tire;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeWarehouse(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9]/g, "");
}

export function createQuote(
  tires: Tire[],
  tireId: string,
  quantity: number,
  warehouseQuery?: string,
): Quote {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    throw new Error("La cantidad debe ser un entero entre 1 y 20.");
  }
  const tire = requireTire(tires, tireId);
  const requestedWarehouse = normalizeWarehouse(warehouseQuery ?? "");
  const warehouse = requestedWarehouse
    ? tire.warehouses.find((item) =>
        normalizeWarehouse(item.warehouseCode) === requestedWarehouse ||
        normalizeWarehouse(item.warehouseName) === requestedWarehouse
      ) ?? null
    : null;
  if (requestedWarehouse && !warehouse) {
    throw new Error(`La bodega ${warehouseQuery} no está en el stock visible de esta llanta.`);
  }

  const availableUnits = warehouse
    ? warehouse.quantity
    : tire.warehouses.reduce((sum, item) => sum + item.quantity, 0);
  if (availableUnits < quantity) {
    const scope = warehouse ? warehouse.warehouseName : "las bodegas visibles";
    throw new Error(`Stock insuficiente en ${scope}: ${availableUnits} unidades reportadas.`);
  }

  const unitWithoutVat = tire.price.unitWithoutVat;
  const unitKnownChargesTotal = tire.price.unitKnownChargesTotal;
  const subtotalWithoutVat = unitWithoutVat === null
    ? null
    : roundMoney(unitWithoutVat * quantity);
  const ecoValueTotal = tire.price.ecoValue === null
    ? null
    : roundMoney(tire.price.ecoValue * quantity);
  const vatPercent = tire.price.vatPercent;
  const vatTotal =
    subtotalWithoutVat === null || ecoValueTotal === null || vatPercent === null
      ? null
      : roundMoney((subtotalWithoutVat + ecoValueTotal) * vatPercent / 100);
  const totalKnownCharges =
    subtotalWithoutVat === null || ecoValueTotal === null || vatTotal === null
      ? null
      : roundMoney(subtotalWithoutVat + ecoValueTotal + vatTotal);
  const singleWarehouseCanFulfill = warehouse !== null || tire.warehouses.some(
    (item) => item.quantity >= quantity,
  );

  return {
    tireId,
    quantity,
    warehouse,
    availableUnits,
    requiresMultipleWarehouses: !singleWarehouseCanFulfill,
    unitWithoutVat,
    unitKnownChargesTotal,
    subtotalWithoutVat,
    ecoValueTotal,
    vatPercent,
    vatTotal,
    totalKnownCharges,
    priceStatus: tire.price.status,
  };
}

export function formatUsd(value: number | null): string {
  if (value === null) return "Precio por confirmar";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}
