import boxConfig from "../../config/boxes.json";
import type { Box } from "../../carriers/types";

export interface BoxPreset {
  name: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
}

export const boxPresets: BoxPreset[] = boxConfig.presets;

/** Upper bound so a typo in "Duplicate ×N" can't create 5000 rows. */
export const MAX_BOXES = 99;

export function isValidBox(b: Box): boolean {
  return [b.lengthCm, b.widthCm, b.heightCm, b.weightKg].every(
    (n) => Number.isFinite(n) && n > 0,
  );
}

/** Parse and sanitize boxes coming from a form post (JSON string). */
export function parseBoxes(raw: FormDataEntryValue | null): Box[] {
  if (typeof raw !== "string" || !raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data.slice(0, MAX_BOXES).map((b) => ({
    lengthCm: Number(b?.lengthCm) || 0,
    widthCm: Number(b?.widthCm) || 0,
    heightCm: Number(b?.heightCm) || 0,
    weightKg: Number(b?.weightKg) || 0,
    ...(typeof b?.presetName === "string" ? { presetName: b.presetName } : {}),
  }));
}
