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
  concerns: string[];
  products: Product[];
  raw: unknown;
};

export const API_BASE_URL: string =
  (import.meta.env['VITE_ANALYSIS_API_URL'] as string | undefined)?.replace(/\/$/, "") ??
  "http://localhost:8000";

const POSITIVE_KEYS = ["hydration", "health", "moisture", "elasticity", "shine", "density", "strength", "smoothness"];

function titleize(key: string) {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function toPercent(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n)) return null;
  const pct = n >= 0 && n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Accepts either { acne: 0.24 }, { acne: { score, confidence, note } } or [{ name/label, score, ... }]. */
function normalizeMetrics(input: unknown): Metric[] {
  if (!input) return [];
  const entries: Array<[string, unknown]> = Array.isArray(input)
    ? input.map((item, i) => {
        const rec = isRecord(item) ? item : {};
        const name = (rec['key'] ?? rec['name'] ?? rec['label'] ?? `metric_${i}`) as string;
        return [String(name), item];
      })
    : isRecord(input)
      ? Object.entries(input)
      : [];

  const metrics: Metric[] = [];
  for (const [key, value] of entries) {
    let score: number | null = null;
    let confidence: number | null = null;
    let note: string | null = null;

    if (isRecord(value)) {
      score = toPercent(value['score'] ?? value['value'] ?? value['severity'] ?? value['level'] ?? value['percentage']);
      confidence = toPercent(value['confidence'] ?? value['certainty'] ?? value['probability']);
      const n = value['note'] ?? value['description'] ?? value['detail'] ?? value['comment'];
      note = typeof n === "string" ? n : null;
    } else {
      score = toPercent(value);
    }
    if (score === null) continue;

    const lower = key.toLowerCase();
    metrics.push({
      key,
      label: titleize(key),
      score,
      confidence,
      note,
      positive: POSITIVE_KEYS.some((p) => lower.includes(p)),
    });
  }
  return metrics;
}

function normalizeProducts(input: unknown): Product[] {
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

export function normalizeAnalysis(payload: unknown): AnalysisResult {
  const root = isRecord(payload) ? payload : {};
  const data = isRecord(root['data']) ? (root['data'] as Record<string, unknown>) : root;

  const skin = normalizeMetrics(
    data['skin_analysis'] ?? data['skinAnalysis'] ?? data['skin'] ?? data['metrics'] ?? data['scores'],
  );
  const hair = normalizeMetrics(data['hair_analysis'] ?? data['hairAnalysis'] ?? data['hair']);

  const overallRaw = data['overall'] ?? data['overall_score'] ?? data['skin_health'] ?? data['overallScore'];
  let overall: Metric | null = null;
  if (overallRaw !== undefined && overallRaw !== null) {
    overall = normalizeMetrics({ overall: overallRaw })[0] ?? null;
    if (overall) overall = { ...overall, label: "Overall", positive: true };
  }
  if (!overall) {
    const health = skin.find((m) => m.key.toLowerCase().includes("health"));
    if (health) overall = { ...health, label: "Overall", positive: true };
  }

  const concernsRaw = data['concerns'] ?? data['detected_concerns'] ?? data['issues'];
  const concerns = Array.isArray(concernsRaw)
    ? concernsRaw
        .map((c) => (typeof c === "string" ? c : isRecord(c) ? String(c['name'] ?? c['label'] ?? "") : ""))
        .filter(Boolean)
    : [];

  const summaryRaw = data['summary'] ?? data['description'] ?? data['message'];

  return {
    summary: typeof summaryRaw === "string" ? summaryRaw : null,
    overall,
    skin,
    hair,
    concerns,
    products: normalizeProducts(
      data['products'] ?? data['recommendations'] ?? data['recommended_products'] ?? data['recommendedProducts'],
    ),
    raw: payload,
  };
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

export async function analyzeImage(imageDataUrl: string, signal?: AbortSignal): Promise<AnalysisResult> {
  const blob = await dataUrlToBlob(imageDataUrl);
  const form = new FormData();
  const ext = blob.type === "image/png" ? "png" : "jpg";
  form.append("file", blob, `selfie.${ext}`);
  form.append("image", blob, `selfie.${ext}`);

  const response = await fetch(`${API_BASE_URL}/api/recommend`, {
    method: "POST",
    body: form,
    signal: signal ?? null,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Analysis failed (${response.status}). ${text.slice(0, 200)}`.trim());
  }
  return normalizeAnalysis(await response.json());
}
