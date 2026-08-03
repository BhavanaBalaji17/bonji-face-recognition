import type { BonjiProduct } from "./bonji-catalog-types";

const FEED_URL = "https://bonji.in/products.json?limit=250";

function stripHtml(html: unknown): string | null {
  if (typeof html !== "string") return null;
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > 220 ? `${text.slice(0, 217)}…` : text;
}

function formatPrice(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return `₹${num.toFixed(2).replace(/\.00$/, "")}`;
}

export async function fetchBonjiCatalog(): Promise<BonjiProduct[]> {
  const response = await fetch(FEED_URL, {
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; BonjiSkinLab/1.0)" },
  });
  if (!response.ok) throw new Error(`Bonji product feed responded ${response.status}`);
  const payload = (await response.json()) as { products?: unknown };
  const products = Array.isArray(payload?.products) ? payload.products : [];

  return products.map((raw) => {
    const item = raw as Record<string, unknown>;
    const images = Array.isArray(item['images']) ? (item['images'] as Record<string, unknown>[]) : [];
    const variants = Array.isArray(item['variants']) ? (item['variants'] as Record<string, unknown>[]) : [];
    const handle = String(item['handle'] ?? "");
    return {
      id: String(item['id'] ?? handle),
      title: String(item['title'] ?? handle),
      handle,
      description: stripHtml(item['body_html']),
      price: formatPrice(variants[0]?.['price']),
      image: (images[0]?.['src'] as string | undefined) ?? null,
      url: `https://bonji.in/products/${handle}`,
      tags: Array.isArray(item['tags']) ? (item['tags'] as unknown[]).map(String) : [],
      productType: (item['product_type'] as string | undefined) || null,
    };
  });
}
