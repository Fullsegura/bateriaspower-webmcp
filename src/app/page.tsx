import { SearchToSaleExperience } from "@/components/search-to-sale-experience";
import { CatalogProvider } from "@/features/catalog/catalog-context";

export default function Home() {
  return (
    <CatalogProvider>
      <SearchToSaleExperience />
    </CatalogProvider>
  );
}
