import { describe, expect, it } from "vitest";

import {
  MAX_PACKAGES,
  addGroup,
  expandGroups,
  groupBoxes,
  groupSummary,
  packageCount,
  rangeLabel,
  totalWeightKg,
  updateGroup,
  validatePackages,
  type PackageGroup,
} from "./packages";

const g = (id: number, qty: number, l: number, w: number, h: number, kg: number): PackageGroup => ({
  id,
  qty,
  lengthCm: l,
  widthCm: w,
  heightCm: h,
  weightKg: kg,
});

describe("package groups", () => {
  it("expands Qty into identical packages and groups them back", () => {
    const groups = [g(1, 6, 45, 35, 30, 6), g(2, 2, 60, 45, 45, 12)];
    const boxes = expandGroups(groups);
    expect(boxes).toHaveLength(8);
    expect(groupBoxes(boxes).map((x) => x.qty)).toEqual([6, 2]);
  });

  it("labels ranges and summaries", () => {
    const groups = [g(1, 6, 45, 35, 30, 6), g(2, 1, 60, 45, 45, 0)];
    expect(rangeLabel(groups, 0)).toBe("1–6");
    expect(rangeLabel(groups, 1)).toBe("7");
    expect(groupSummary(groups[0])).toBe("45×35×30  6.0 kg each");
    expect(groupSummary(groups[1])).toBe("60×45×45  weight missing");
  });

  it("totals packages and kg", () => {
    const groups = [g(1, 6, 45, 35, 30, 6), g(2, 2, 60, 45, 45, 12.5)];
    expect(packageCount(groups)).toBe(8);
    expect(totalWeightKg(groups)).toBe(61);
  });

  it("caps at the maximum", () => {
    const r1 = addGroup([], { qty: 95, lengthCm: 1, widthCm: 1, heightCm: 1, weightKg: 1 }, 1);
    const r2 = addGroup(r1.groups, { qty: 10, lengthCm: 1, widthCm: 1, heightCm: 1, weightKg: 1 }, 2);
    expect(r2.added).toBe(MAX_PACKAGES - 95);
    expect(r2.clamped).toBe(true);
    expect(packageCount(r2.groups)).toBe(MAX_PACKAGES);
    expect(updateGroup(r2.groups, 2, { qty: 50, lengthCm: 1, widthCm: 1, heightCm: 1, weightKg: 1 })[1].qty).toBe(4);
  });

  it("says which line is missing what", () => {
    expect(validatePackages([])).toEqual(["Add at least one package."]);
    expect(
      validatePackages([g(1, 6, 45, 35, 30, 6), g(2, 2, 60, 0, 45, 0), g(3, 1, 0, 0, 0, 3)]),
    ).toEqual([
      "Line 2 (packages 7–8): missing W, weight",
      "Line 3 (package 9): missing L, W, H",
    ]);
    expect(validatePackages([g(1, 1, 10, 10, 10, 1)])).toEqual([]);
  });
});
