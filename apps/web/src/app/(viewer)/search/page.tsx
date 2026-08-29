import { SearchExperience } from "@/components/search/search-experience";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const parameters = await searchParams;
  const initialQuery = typeof parameters.q === "string" ? parameters.q.slice(0, 120) : "";
  return <SearchExperience initialQuery={initialQuery} />;
}
