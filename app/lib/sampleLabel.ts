import type { Box } from "../../carriers/types";
import type { MappedFields } from "./rules";

/**
 * "Preview sample label": 4x6 pages, one per box, watermarked
 * "SAMPLE — NOT A REAL LABEL". Built in the browser; nothing is sent anywhere.
 * Shows exactly the fields this courier will receive (config/carrier_fields.json).
 */

export interface SampleLabelInput {
  carrierName: string;
  serviceName: string;
  orderName: string;
  fields: MappedFields;
  shipFrom: {
    name: string;
    address1: string;
    address2: string | null;
    city: string;
    provinceCode: string;
    postalCode: string;
  } | null;
  boxes: Box[];
}

export const SAMPLE_WATERMARK = "SAMPLE — NOT A REAL LABEL";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

const lines = (xs: (string | null | undefined)[]) =>
  xs.filter((x): x is string => !!x && !!x.trim()).map((x) => `<div>${esc(x)}</div>`).join("");

export function sampleLabelHtml(input: SampleLabelInput): string {
  const f = input.fields;
  const from = input.shipFrom;
  const n = input.boxes.length;
  const pages = input.boxes
    .map(
      (b, i) => `
  <section class="label">
    <div class="wm">${esc(SAMPLE_WATERMARK)}</div>
    <div class="top"><span>${esc(input.carrierName)}</span><span>${esc(input.serviceName)}</span></div>
    <div class="from"><b>FROM</b>${
      from
        ? lines([from.name, from.address1, from.address2, `${from.city} ${from.provinceCode} ${from.postalCode}`])
        : "<div>(ship-from address not confirmed — see Setup)</div>"
    }</div>
    <div class="to"><b>SHIP TO</b>${lines([
      f.name,
      f.attention ? `ATTN: ${f.attention}` : null,
      f.company,
      f.address1,
      f.address2,
      `${f.city} ${f.provinceCode}  ${f.postalCode}`,
      f.phone ? `Tel: ${f.phone}` : null,
    ])}</div>
    <div class="meta">
      ${f.reference ? `<div>Ref: ${esc(f.reference)}</div>` : ""}
      ${f.signature ? `<div>${esc(f.signature)}</div>` : ""}
      ${f.residential === null ? "" : `<div>${f.residential ? "Residential" : "Commercial"}</div>`}
      <div>${b.lengthCm}×${b.widthCm}×${b.heightCm} cm · ${b.weightKg} kg</div>
    </div>
    <div class="track">TRACKING # — SAMPLE</div>
    <div class="box">BOX ${i + 1} OF ${n}</div>
  </section>`,
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(SAMPLE_WATERMARK)} — ${esc(input.orderName)}</title>
<style>
  @page { size: 4in 6in; margin: 0; }
  body { margin: 0; font-family: Arial, sans-serif; color: #000; }
  .label { position: relative; width: 4in; height: 6in; box-sizing: border-box; padding: .25in;
           page-break-after: always; display: flex; flex-direction: column; gap: 8px; overflow: hidden;
           border: 1px dashed #999; }
  .wm { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-35deg);
        font-size: 30pt; font-weight: bold; color: rgba(200, 0, 0, .28); white-space: nowrap;
        pointer-events: none; z-index: 2; }
  .top { display: flex; justify-content: space-between; font-weight: bold; font-size: 13pt;
         border-bottom: 3px solid #000; padding-bottom: 4px; }
  .from { font-size: 8.5pt; line-height: 1.25; }
  .to { font-size: 13pt; line-height: 1.3; border-top: 1px solid #000; padding-top: 6px; }
  b { display: block; font-size: 8pt; letter-spacing: 1px; }
  .meta { font-size: 9pt; line-height: 1.3; }
  .track { margin-top: auto; height: .9in; border: 2px dashed #000; display: flex;
           align-items: center; justify-content: center; font-weight: bold; letter-spacing: 2px; }
  .box { text-align: center; font-size: 22pt; font-weight: bold; border: 3px solid #000; padding: 4px; }
</style></head><body>${pages}
<script>window.onload = function () { window.print(); };</script>
</body></html>`;
}

/** Opens the preview in a new window. Returns false when pop-ups are blocked. */
export function openSampleLabels(input: SampleLabelInput): boolean {
  const w = window.open("", "_blank", "width=480,height=760");
  if (!w) return false;
  w.document.write(sampleLabelHtml(input));
  w.document.close();
  return true;
}
