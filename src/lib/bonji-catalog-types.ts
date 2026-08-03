export type BonjiProduct = {
  id: string;
  title: string;
  handle: string;
  description: string | null;
  price: string | null;
  image: string | null;
  url: string;
  tags: string[];
  productType: string | null;
};
