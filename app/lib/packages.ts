import type { Box } from "../../carriers/types";
import { MAX_BOXES } from "./boxes";

/**
 * Package entry model shared by /desk/:orderId and /app/ship/:id.
 * Staff always type package info: presets fill L/W/H only, weight is never
 * prefilled (not from presets, not from product data). Browser-safe.
 */

export interface PackageGroup {
  id: number;
  /** N identical packages. */
  qty: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
}

export type PackageInput = Omit<PackageGroup, "id">;

export const MAX_PACKAGES = MAX_BOXES;

export const packageCount = (groups: PackageGroup[]) => groups.reduce((n, g) => n + g.qty, 0);

export const totalWeightKg = (groups: PackageGroup[]) =>
  groups.reduce((s, g) => s + g.qty * (g.weightKg || 0), 0);

/** One Box per physical package, in order (what carriers receive). */
export function expandGroups(groups: PackageGroup[]): Box[] {
  return groups.flatMap((g) =>
    Array.from({ length: g.qty }, () => ({
      lengthCm: g.lengthCm,
      widthCm: g.widthCm,
      heightCm: g.heightCm,
      weightKg: g.weightKg,
    })),
  );
}

/** Saved boxes back into groups: consecutive identical packages become one line. */
export function groupBoxes(boxes: Box[], firstId = 1): PackageGroup[] {
  const out: PackageGroup[] = [];
  for (const b of boxes) {
    const last = out[out.length - 1];
    if (
      last &&
      last.lengthCm === b.lengthCm &&
      last.widthCm === b.widthCm &&
      last.heightCm === b.heightCm &&
      last.weightKg === b.weightKg
    ) {
      last.qty += 1;
    } else {
      out.push({
        id: firstId + out.length,
        qty: 1,
        lengthCm: b.lengthCm,
        widthCm: b.widthCm,
        heightCm: b.heightCm,
        weightKg: b.weightKg,
      });
    }
  }
  return out;
}

/** Adds a line, clamping qty so the total never exceeds MAX_PACKAGES. */
export function addGroup(
  groups: PackageGroup[],
  input: PackageInput,
  id: number,
): { groups: PackageGroup[]; added: number; clamped: boolean } {
  const room = MAX_PACKAGES - packageCount(groups);
  const want = Math.max(1, Math.floor(input.qty || 1));
  const added = Math.max(0, Math.min(want, room));
  if (added === 0) return { groups, added: 0, clamped: true };
  return { groups: [...groups, { ...input, qty: added, id }], added, clamped: added < want };
}

/** Replaces one line (edit), clamping qty to the room left. */
export function updateGroup(groups: PackageGroup[], id: number, input: PackageInput): PackageGroup[] {
  const others = packageCount(groups.filter((g) => g.id !== id));
  const qty = Math.max(1, Math.min(Math.floor(input.qty || 1), MAX_PACKAGES - others));
  return groups.map((g) => (g.id === id ? { ...input, qty, id } : g));
}

export function missingFields(g: PackageInput): string[] {
  const m: string[] = [];
  if (!(g.lengthCm > 0)) m.push("L");
  if (!(g.widthCm > 0)) m.push("W");
  if (!(g.heightCm > 0)) m.push("H");
  if (!(g.weightKg > 0)) m.push("weight");
  return m;
}

/** "1–6" or "7": package numbers covered by line `index`. */
export function rangeLabel(groups: PackageGroup[], index: number): string {
  const start = packageCount(groups.slice(0, index)) + 1;
  const end = start + groups[index].qty - 1;
  return start === end ? String(start) : `${start}–${end}`;
}

const dim = (n: number) => (n > 0 ? String(n) : "?");

/** "45×35×30  6.0 kg each" (with ? / "weight missing" for gaps). */
export function groupSummary(g: PackageInput): string {
  const weight = g.weightKg > 0 ? `${g.weightKg.toFixed(1)} kg${g.qty > 1 ? " each" : ""}` : "weight missing";
  return `${dim(g.lengthCm)}×${dim(g.widthCm)}×${dim(g.heightCm)}  ${weight}`;
}

/** One message per incomplete line, e.g. "Line 2 (packages 7–8): missing weight". */
export function validatePackages(groups: PackageGroup[]): string[] {
  if (groups.length === 0) return ["Add at least one package."];
  const msgs: string[] = [];
  groups.forEach((g, i) => {
    const m = missingFields(g);
    if (m.length) {
      const range = rangeLabel(groups, i);
      const label = g.qty > 1 ? `packages ${range}` : `package ${range}`;
      msgs.push(`Line ${i + 1} (${label}): missing ${m.join(", ")}`);
    }
  });
  if (packageCount(groups) > MAX_PACKAGES) msgs.push(`Maximum ${MAX_PACKAGES} packages.`);
  return msgs;
}
