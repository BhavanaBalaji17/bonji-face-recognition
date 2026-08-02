import type { ScanConcern, ScanResult, ScanWarning } from "@/face-scanner/scanner";

export type Metric = {
  key: string;
  label: string;
  score: number;
  confidence?: number | null;
  note?: string | null;
  positive?: boolean;
};

export type Product = {
  id: string;
  name: string;
  image?: string | null;
  concern?: string | null;
  ingredients: string[];
  benefits: string[];
  description?: string | null;
  price?: string | null;
  url?: string | null;
};

export type AnalysisResult = {
  summary?: string | null;
  overall?: Metric | null;
  skin: Metric[];
  hair: Metric[];
  concerns: ScanConcern[];
  warnings: ScanWarning[];
  notes: string[];
  completeness?: ScanResult["completeness"];
  captureConfidence: number;
  products: Product[];
  productsError?: string | null;
  raw: ScanResult;
};

export const API_BASE_URL: string =
  (import.meta.env['VITE_ANALYSIS_API_URL'] as string | undefined)?.replace(/\/$/, "") ??
  "http://localhost:8000";

const POSITIVE_KEYS = ["shine", "hydration", "health", "moisture", "elasticity", "smoothness"];

function titleize(key: string) {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const pct = (v: number) => Math.max(0, Math.min(100, Math.round(v * 100)));

function metricsFrom(
  scores: Record<string, number> | undefined,
  area: "skin" | "hair",
  concerns: ScanConcern[],
  captureConfidence: number,
): Metric[] {
  if (!scores) return [];
  return Object.entries(scores).map(([key, score]) => {
    const concernId = area === "hair" ? `hair${key.charAt(0).toUpperCase()}${key.slice(1)}` : key;
    const concern = concerns.find((c) => c.id === concernId);
    const lower = key.toLowerCase();
    return {
      key: `${area}:${key}`,
      label: titleize(key),
      score: pct(score),
      confidence: pct(concern?.confidence ?? captureConfidence),
      note: concern ? `Flagged as ${concern.severity}` : null,
      positive: POSITIVE_KEYS.some((p) => lower.includes(p)),
    };
  });
}

export function normalizeProducts(input: unknown): Product[] {
  if (!Array.isArray(input)) return [];
  return input.filter(isRecord).map((item, i) => {
    const toArray = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.map((x) => (typeof x === "string" ? x : isRecord(x) ? String(x['name'] ?? "") : String(x))).filter(Boolean)
        : typeof v === "string"
          ? v.split(/[,·|]/).map((s) => s.trim()).filter(Boolean)
          : [];
    const price = item['price'];
    return {
      id: String(item['id'] ?? item['sku'] ?? item['name'] ?? i),
      name: String(item['name'] ?? item['title'] ?? "Product"),
      image: (item['image'] ?? item['image_url'] ?? item['imageUrl'] ?? item['thumbnail'] ?? null) as string | null,
      concern: (item['concern'] ?? item['concern_addressed'] ?? item['category'] ?? null) as string | null,
      ingredients: toArray(item['ingredients'] ?? item['key_ingredients']),
      benefits: toArray(item['benefits'] ?? item['key_benefits']),
      description: (item['description'] ?? item['short_description'] ?? null) as string | null,
      price: price === null || price === undefined ? null : typeof price === "number" ? `₹${price}` : String(price),
      url: (item['url'] ?? item['link'] ?? item['product_url'] ?? null) as string | null,
    };
  });
}

/** Sends the scan concerns to the Python backend for Bonji product recommendations. */
export async function fetchRecommendations(concerns: ScanConcern[], signal?: AbortSignal): Promise<Product[]> {
  const response = await fetch(`${API_BASE_URL}/api/recommend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ concerns }),
    signal: signal ?? null,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Recommendations failed (${response.status}). ${text.slice(0, 200)}`.trim());
  }
  const payload: unknown = await response.json();
  const root = isRecord(payload) ? payload : {};
  const data = isRecord(root['data']) ? (root['data'] as Record<string, unknown>) : root;
  return normalizeProducts(
    Array.isArray(payload)
      ? payload
      : data['products'] ?? data['recommendations'] ?? data['recommended_products'] ?? data['recommendedProducts'],
  );
}

export function buildAnalysis(scan: ScanResult, products: Product[], productsError?: string | null): AnalysisResult {
  const captureConfidence = scan.confidence ?? 0;
  const skin = metricsFrom(scan.skin?.scores, "skin", scan.concerns, captureConfidence);
  const hair = metricsFrom(scan.hair?.scores, "hair", scan.concerns, captureConfidence);

  const negatives = skin.filter((m) => !m.positive);
  const overall: Metric | null = negatives.length
    ? {
        key: "overall",
        label: "Overall",
        score: Math.round(100 - negatives.reduce((a, m) => a + m.score, 0) / negatives.length),
        confidence: pct(captureConfidence),
        positive: true,
      }
    : null;

  const top = scan.concerns.slice(0, 3).map((c) => titleize(c.id).toLowerCase());
  const summary = scan.concerns.length
    ? `We detected ${scan.concerns.length} signal${scan.concerns.length > 1 ? "s" : ""} worth attention — most notably ${top.join(", ")}.`
    : "No concerns crossed the flagging threshold in this capture.";

  return {
    summary,
    overall,
    skin,
    hair,
    concerns: scan.concerns,
    warnings: scan.warnings ?? [],
    notes: scan.notes ?? [],
    completeness: scan.completeness,
    captureConfidence: pct(captureConfidence),
    products,
    productsError: productsError ?? null,
    raw: scan,
  };
}
