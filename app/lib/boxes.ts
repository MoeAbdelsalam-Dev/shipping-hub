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

/** Parse and sanitize boxes from a form post (JSON string) or a JSON body (array). */
export function parseBoxes(raw: unknown): Box[] {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return [];
    }
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
