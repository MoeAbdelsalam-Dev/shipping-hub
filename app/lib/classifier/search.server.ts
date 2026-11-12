/**
 * Web search behind an interface. Live provider: Brave Search API
 * (BRAVE_SEARCH_API_KEY). Without a key we use a deterministic mock so the
 * flow can be tested end to end. Google Custom Search is closed to new
 * customers, so it is not an option.
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchProvider {
  readonly id: string;
  search(query: string, count?: number): Promise<SearchResult[]>;
}

const BRAVE_URL = "https://api.search.brave.com/res/v1/web/search";

function stripTags(s: string) {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

export function braveSearch(apiKey: string): SearchProvider {
  return {
    id: "brave",
    async search(query, count = 10) {
      const url = `${BRAVE_URL}?${new URLSearchParams({
        q: query,
        count: String(count),
        country: "CA",
        safesearch: "moderate",
      })}`;
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": apiKey,
        },
      });
      if (!res.ok) {
        // Never echo the query (customer address) into logs/errors.
        throw new Error(`Brave Search failed with HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        web?: { results?: { title?: string; url?: string; description?: string }[] };
      };
      return (data.web?.results ?? [])
        .filter((r) => r.url)
        .map((r) => ({
          title: stripTags(r.title ?? ""),
          url: r.url!,
          snippet: stripTags(r.description ?? ""),
        }));
    },
  };
}

/**
 * Fake search results shaped by the query, so every branch of the classifier
 * can be exercised:
 *  - a query that is a quoted business name -> confirms it at the address
 *  - an address with a unit (contains "Unit"/"#"/"Suite"/"apt") -> condo listing
 *  - an address containing "Plaza", "Mall", "Industrial", "Blvd" -> business x2
 *  - anything else -> nothing useful (-> unsure)
 */
export const mockSearch: SearchProvider = {
  id: "mock",
  async search(query) {
    const q = query.toLowerCase();
    const business = query.match(/^"([^"]+)"/)?.[1];
    if (business) {
      return [
        {
          title: `${business} | Hours & Location`,
          url: "https://example.com/mock/business-profile",
          snippet: `${business} — visit us at our location. ${query.replace(/^"[^"]+"\s*/, "")}`,
        },
      ];
    }
    if (/\b(suite|ste)\b/.test(q)) {
      return [
        {
          title: "Acme Office Supply Ltd. — Contact",
          url: "https://example.com/mock/acme-contact",
          snippet: `Acme Office Supply Ltd., ${query}. Open Mon–Fri 9–5.`,
        },
        {
          title: "Acme Office Supply Ltd. reviews",
          url: "https://example.com/mock/acme-reviews",
          snippet: `Acme Office Supply Ltd. at ${query} — 4.2 stars.`,
        },
      ];
    }
    if (/\b(unit|apt|apartment)\b|#\s*\d/.test(q)) {
      return [
        {
          title: "2 Bed Condo for Sale — MLS® listing",
          url: "https://example.com/mock/realtor-listing",
          snippet: `Bright 2 bedroom condo in a residential tower. ${query}.`,
        },
        {
          title: "Condo building amenities & units for rent",
          url: "https://example.com/mock/condo-rentals",
          snippet: "Suites for rent in this residential condominium building.",
        },
      ];
    }
    if (/\b(plaza|mall|industrial|blvd|business park)\b/.test(q)) {
      return [
        {
          title: "Northstar Distribution Inc.",
          url: "https://example.com/mock/northstar",
          snippet: `Northstar Distribution Inc. warehouse at ${query}.`,
        },
        {
          title: "Northstar Distribution Inc. - Yelp",
          url: "https://example.com/mock/northstar-yelp",
          snippet: `Northstar Distribution Inc., ${query}. Wholesale.`,
        },
      ];
    }
    return [];
  },
};

/** Live provider, or null when BRAVE_SEARCH_API_KEY is missing (no demo data by default). */
export function getSearchProvider(): SearchProvider | null {
  const key = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (key) return braveSearch(key);
  return process.env.CLASSIFIER_DEMO === "1" ? mockSearch : null;
}
