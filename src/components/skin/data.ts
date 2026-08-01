
export type Metric = {
  key: string;
  label: string;
  score: number;
  confidence: number;
  note: string;
  positive?: boolean;
};

export const metrics: Metric[] = [
  { key: "acne", label: "Acne", score: 24, confidence: 92, note: "Mild congestion around the T-zone" },
  { key: "pigmentation", label: "Pigmentation", score: 38, confidence: 88, note: "Light sun spots on the cheeks" },
  { key: "redness", label: "Redness", score: 19, confidence: 90, note: "Minimal irritation detected" },
  { key: "darkCircles", label: "Dark Circles", score: 46, confidence: 85, note: "Moderate shadowing under the eyes" },
  { key: "pores", label: "Pores", score: 33, confidence: 87, note: "Slightly visible around the nose" },
  { key: "oiliness", label: "Oiliness", score: 41, confidence: 84, note: "Combination skin tendency" },
  { key: "dryness", label: "Dryness", score: 28, confidence: 86, note: "Small dry patches near the jaw" },
  { key: "fineLines", label: "Fine Lines", score: 22, confidence: 83, note: "Early expression lines only" },
  { key: "hydration", label: "Hydration", score: 72, confidence: 91, note: "Well hydrated overall", positive: true },
  { key: "health", label: "Skin Health", score: 78, confidence: 94, note: "Healthy barrier function", positive: true },
];

export type Product = {
  id: string;
  name: string;
  image?: string | null;
  concern: string;
  ingredients: string[];
  benefits: string[];
  description: string;
  price?: string | null;
  url?: string | null;
};

/**
 * Placeholder data only — this section is designed to be populated
 * dynamically from the backend using the AI skin analysis results.
 */
export const placeholderProducts: Product[] = [
  {
    id: "placeholder-1",
    name: "Product Name",
    image: null,
    concern: "Concern Addressed",
    ingredients: ["Key Ingredient", "Key Ingredient"],
    benefits: ["Benefit", "Benefit", "Benefit"],
    description: "Short product description will appear here once recommendations are loaded.",
    price: "₹—",
  },
  {
    id: "placeholder-2",
    name: "Product Name",
    image: null,
    concern: "Concern Addressed",
    ingredients: ["Key Ingredient", "Key Ingredient"],
    benefits: ["Benefit", "Benefit"],
    description: "Short product description will appear here once recommendations are loaded.",
    price: "₹—",
  },
  {
    id: "placeholder-3",
    name: "Product Name",
    image: null,
    concern: "Concern Addressed",
    ingredients: ["Key Ingredient", "Key Ingredient"],
    benefits: ["Benefit", "Benefit", "Benefit"],
    description: "Short product description will appear here once recommendations are loaded.",
    price: "₹—",
  },
];

