import { useRef, useState, type KeyboardEvent } from "react";

import type { BoxPreset } from "../lib/boxes";
import {
  MAX_PACKAGES,
  addGroup,
  groupSummary,
  missingFields,
  packageCount,
  rangeLabel,
  totalWeightKg,
  updateGroup,
  type PackageGroup,
  type PackageInput,
} from "../lib/packages";

/**
 * Package entry, shared by /desk/:orderId and /app/ship/:id. Plain HTML
 * inputs + app/styles/packages.css (works inside and outside Shopify admin).
 *
 * Quick-entry row: Qty, L, W, H (cm), Weight (kg), Add. Enter adds and returns
 * focus to Qty; Enter on an empty row calls onEnterEmpty (= Get quotes).
 * Presets fill L/W/H only — weight is never prefilled.
 */

interface Props {
  groups: PackageGroup[];
  onChange: (groups: PackageGroup[]) => void;
  presets: BoxPreset[];
  /** Validation messages to show (set by the parent when Get quotes is pressed). */
  errors?: string[];
  onEnterEmpty?: () => void;
}

interface Draft {
  qty: string;
  l: string;
  w: string;
  h: string;
  kg: string;
}
const EMPTY: Draft = { qty: "1", l: "", w: "", h: "", kg: "" };

const num = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const toInput = (d: Draft): PackageInput => ({
  qty: Math.max(1, Math.floor(num(d.qty) || 1)),
  lengthCm: num(d.l),
  widthCm: num(d.w),
  heightCm: num(d.h),
  weightKg: num(d.kg),
});
const toDraft = (g: PackageGroup): Draft => ({
  qty: String(g.qty),
  l: g.lengthCm ? String(g.lengthCm) : "",
  w: g.widthCm ? String(g.widthCm) : "",
  h: g.heightCm ? String(g.heightCm) : "",
  kg: g.weightKg ? String(g.weightKg) : "",
});

function Fields({
  d,
  set,
  onEnter,
  qtyRef,
  kgRef,
}: {
  d: Draft;
  set: (d: Draft) => void;
  onEnter: () => void;
  qtyRef?: React.Ref<HTMLInputElement>;
  kgRef?: React.Ref<HTMLInputElement>;
}) {
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onEnter();
    }
  };
  const field = (
    k: keyof Draft,
    label: string,
    step: string,
    ref?: React.Ref<HTMLInputElement>,
  ) => (
    <label className={`pk-field pk-${k}`}>
      <span>{label}</span>
      <input
        ref={ref}
        type="number"
        inputMode="decimal"
        min="0"
        step={step}
        value={d[k]}
        onChange={(e) => set({ ...d, [k]: e.target.value })}
        onKeyDown={key}
      />
    </label>
  );
  return (
    <>
      {field("qty", "Qty", "1", qtyRef)}
      {field("l", "L cm", "1")}
      {field("w", "W cm", "1")}
      {field("h", "H cm", "1")}
      {field("kg", "Weight kg", "0.1", kgRef)}
    </>
  );
}

export function PackageEntry({ groups, onChange, presets, errors = [], onEnterEmpty }: Props) {
  const [quick, setQuick] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<{ id: number; d: Draft } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const kgRef = useRef<HTMLInputElement>(null);

  const count = packageCount(groups);
  const full = count >= MAX_PACKAGES;
  const nextId = () => groups.reduce((m, g) => Math.max(m, g.id), 0) + 1;

  const add = () => {
    const empty = !quick.l && !quick.w && !quick.h && !quick.kg;
    if (empty) {
      onEnterEmpty?.();
      return;
    }
    const r = addGroup(groups, toInput(quick), nextId());
    if (r.added === 0) {
      setNotice(`Maximum ${MAX_PACKAGES} packages reached.`);
      return;
    }
    onChange(r.groups);
    setNotice(r.clamped ? `Only ${r.added} added — maximum is ${MAX_PACKAGES} packages.` : null);
    setQuick(EMPTY);
    qtyRef.current?.focus();
    qtyRef.current?.select();
  };

  const applyPreset = (p: BoxPreset) => {
    setQuick({ ...quick, l: String(p.lengthCm), w: String(p.widthCm), h: String(p.heightCm), kg: "" });
    kgRef.current?.focus();
  };

  const saveEdit = () => {
    if (!editing) return;
    onChange(updateGroup(groups, editing.id, toInput(editing.d)));
    setEditing(null);
  };

  return (
    <div className="pk">
      {presets.length > 0 ? (
        <div className="pk-presets">
          <span className="pk-muted">Presets (L×W×H only):</span>
          {presets.map((p) => (
            <button key={p.name} type="button" className="pk-chip" onClick={() => applyPreset(p)}>
              {p.name} {p.lengthCm}×{p.widthCm}×{p.heightCm}
            </button>
          ))}
        </div>
      ) : null}

      <div className="pk-quick">
        <Fields d={quick} set={setQuick} onEnter={add} qtyRef={qtyRef} kgRef={kgRef} />
        <button type="button" className="pk-add" onClick={add} disabled={full}>
          Add
        </button>
      </div>
      <div className="pk-muted pk-hint">
        Enter adds the line. Enter on an empty line = Get quotes.
      </div>
      {notice ? <div className="pk-notice">{notice}</div> : null}

      {groups.length === 0 ? (
        <div className="pk-empty">No packages yet — type the first one above.</div>
      ) : (
        <ol className="pk-lines">
          {groups.map((g, i) => {
            const missing = missingFields(g);
            const isEditing = editing?.id === g.id;
            return (
              <li key={g.id} className={missing.length ? "pk-line pk-bad" : "pk-line"}>
                <span className="pk-range">{rangeLabel(groups, i)}</span>
                {isEditing && editing ? (
                  <span className="pk-edit">
                    <Fields
                      d={editing.d}
                      set={(d) => setEditing({ id: g.id, d })}
                      onEnter={saveEdit}
                    />
                    <button type="button" className="pk-btn" onClick={saveEdit}>
                      Save
                    </button>
                    <button type="button" className="pk-btn pk-link" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <>
                    <span className="pk-summary">{groupSummary(g)}</span>
                    {missing.length ? (
                      <span className="pk-missing">missing {missing.join(", ")}</span>
                    ) : null}
                    <span className="pk-actions">
                      <button
                        type="button"
                        className="pk-btn pk-link"
                        onClick={() => setEditing({ id: g.id, d: toDraft(g) })}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="pk-btn pk-link pk-danger"
                        aria-label={`Delete line ${i + 1}`}
                        onClick={() => onChange(groups.filter((x) => x.id !== g.id))}
                      >
                        Delete
                      </button>
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <div className="pk-totals">
        <strong>
          {count} package{count === 1 ? "" : "s"}
        </strong>{" "}
        · {totalWeightKg(groups).toFixed(1)} kg total
        {full ? <span className="pk-muted"> · maximum {MAX_PACKAGES} reached</span> : null}
      </div>

      {errors.length > 0 ? (
        <ul className="pk-errors" role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
