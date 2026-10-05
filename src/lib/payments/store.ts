import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { BillingDetails, PaymentQuote, PaymentTransaction } from "@/types/payment";

export interface StoredQuote extends PaymentQuote { sessionHash: string }
export interface StoredTransaction extends PaymentTransaction {
  sessionHash: string;
  billing: BillingDetails;
  providerTransactionId: string | null;
  createdAt: string;
}
interface PaymentStore { quotes: StoredQuote[]; transactions: StoredTransaction[] }
const SYMBOL = Symbol.for("powerauto.payment.writers");

// Local single-process persistence; not a replacement for the source Prisma store in production.
export async function withPaymentStore<T>(operation: (store: PaymentStore) => T | Promise<T>): Promise<T> {
  const directory = resolve(/* turbopackIgnore: true */ process.env.PAYMENTS_STORAGE_DIR ?? ".local-payments");
  const file = resolve(directory, "payments.json");
  const globalStore = globalThis as typeof globalThis & { [SYMBOL]?: Map<string, Promise<unknown>> };
  const writers = globalStore[SYMBOL] ??= new Map();
  const job = (writers.get(file) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let store: PaymentStore;
    try {
      store = JSON.parse(await readFile(file, "utf8")) as PaymentStore;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      store = { quotes: [], transactions: [] };
    }
    const result = await operation(store);
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(store), { mode: 0o600 });
    await rename(temporary, file);
    return result;
  });
  writers.set(file, job);
  try { return await job; }
  finally { if (writers.get(file) === job) writers.delete(file); }
}

export function publicQuote(quote: StoredQuote): PaymentQuote {
  const { sessionHash: _, ...publicValue } = quote;
  void _;
  return publicValue;
}

export function publicTransaction(transaction: StoredTransaction): PaymentTransaction {
  const { sessionHash: _, billing: __, providerTransactionId: ___, createdAt: ____, ...publicValue } = transaction;
  void _; void __; void ___; void ____;
  return publicValue;
}
