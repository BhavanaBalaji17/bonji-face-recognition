import type { BonjiProduct } from "./bonji-catalog.server";
import type { Product } from "./analysis-api";

export type { BonjiProduct };

const norm = (value: string) =>
  value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const tokens = (value: string) => new Set(norm(value).split(" ").filter((t) => t.length > 2));

function score(query: string, product: BonjiProduct): number {
  const q = norm(query);
  const title = norm(product.title);
  const handle = norm(product.handle);
  if (!q) return 0;
  if (q === title || q === handle) return 1;
  if (title.includes(q) || handle.includes(q) || q.includes(title)) return 0.9;
  const a = tokens(query);
  const b = tokens(`${product.title} ${product.handle}`);
  if (!a.size || !b.size) return 0;
  let hits = 0;
  a.forEach((t) => {
    if (b.has(t)) hits += 1;
  });
  return hits / Math.max(a.size, 1);
}

/** Finds the Bonji feed product matching a name/handle returned by the backend. */
export function matchBonjiProduct(query: string | null | undefined, catalog: BonjiProduct[]): BonjiProduct | null {
  if (!query) return null;
  let best: BonjiProduct | null = null;
  let bestScore = 0;
  for (const product of catalog) {
    const s = score(query, product);
    if (s > bestScore) {
      bestScore = s;
      best = product;
    }
  }
  return bestScore >= 0.5 ? best : null;
}

/** Rewrites backend recommendations onto real Bonji feed data; unmatched items are dropped. */
export function resolveProducts(recommended: Product[], catalog: BonjiProduct[]): Product[] {
  const seen = new Set<string>();
  const out: Product[] = [];
  for (const item of recommended) {
    const match =
      matchBonjiProduct(item.name, catalog) ??
      matchBonjiProduct(item.url?.split("/").pop() ?? null, catalog);
    if (!match || seen.has(match.id)) continue;
    seen.add(match.id);
    out.push({
      id: match.id,
      name: match.title,
      image: match.image,
      concern: item.concern ?? match.productType,
      ingredients: item.ingredients,
      benefits: item.benefits.length ? item.benefits : match.tags.slice(0, 3),
      description: item.description ?? match.description,
      price: match.price ?? item.price ?? null,
      url: match.url,
    });
  }
  return out;
}
