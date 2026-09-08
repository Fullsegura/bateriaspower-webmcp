import { SearchToSaleExperience } from "@/components/search-to-sale-experience";
import { CatalogProvider } from "@/features/catalog/catalog-context";

type HomeProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const initialQuery = firstValue(params.q)?.trim().slice(0, 500);
  const embedded = firstValue(params.embed) === "fullsegura";

  return (
    <CatalogProvider initialQuery={initialQuery}>
      <SearchToSaleExperience embedded={embedded} initialQuery={initialQuery} />
    </CatalogProvider>
  );
}
