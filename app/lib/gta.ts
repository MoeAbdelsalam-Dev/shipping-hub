import gtaConfig from "../../config/gta_fsa.json";

export type Zone = "GTA" | "Non-GTA";
export const ZONE_TAGS: Zone[] = ["GTA", "Non-GTA"];

const prefixes: string[] = gtaConfig.prefixes.map((p) => p.toUpperCase());
const fsas = new Set<string>(
  Object.values(gtaConfig.fsas as Record<string, string[]>)
    .flat()
    .map((f) => f.toUpperCase()),
);

/** "m5v 2t6" -> "M5V" ; returns "" for anything that isn't a Canadian FSA. */
export function fsaOf(postalCode: string | null | undefined): string {
  const clean = (postalCode ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z]\d[A-Z]/.test(clean) ? clean.slice(0, 3) : "";
}

export function zoneFor(
  postalCode: string | null | undefined,
  countryCode: string | null | undefined,
): Zone {
  if ((countryCode ?? "").toUpperCase() !== "CA") return "Non-GTA";
  const fsa = fsaOf(postalCode);
  if (!fsa) return "Non-GTA";
  if (fsas.has(fsa)) return "GTA";
  return prefixes.some((p) => fsa.startsWith(p)) ? "GTA" : "Non-GTA";
}
