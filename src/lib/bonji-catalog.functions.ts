import { createServerFn } from "@tanstack/react-start";
import { fetchBonjiCatalog } from "./bonji-catalog.server";

export const getBonjiCatalog = createServerFn({ method: "GET" }).handler(async () => {
  return await fetchBonjiCatalog();
});
