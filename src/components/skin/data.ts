import serum from "@/assets/product-serum.jpg";
import cream from "@/assets/product-cream.jpg";
import cleanser from "@/assets/product-cleanser.jpg";

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

export const products = [
  {
    name: "Golden Glow Serum",
    image: serum,
    description: "A lightweight vitamin C serum that softens pigmentation and revives dull skin.",
    benefits: ["Brightens tone", "Fades dark spots", "Antioxidant rich"],
  },
  {
    name: "Ceramide Repair Cream",
    image: cream,
    description: "A nourishing barrier cream with ceramides and squalane for lasting comfort.",
    benefits: ["Deep hydration", "Calms redness", "Barrier support"],
  },
  {
    name: "Gentle Clarifying Cleanser",
    image: cleanser,
    description: "A pH-balanced daily cleanser that clears excess oil without stripping moisture.",
    benefits: ["Unclogs pores", "Balances oil", "Non-drying"],
  },
];
