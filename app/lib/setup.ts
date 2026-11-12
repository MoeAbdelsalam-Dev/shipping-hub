/** Setup checklist types + printable view. Browser-safe (no secrets ever). */

/** Checklist items staff set by hand (stored in Setting as "setup.<id>"). */
export const MANUAL_ITEMS = ["staff-account", "owner-approval", "ot"] as const;
export const manualKey = (id: string) => `setup.${id}`;

export type SetupStatus = "done" | "waiting" | "not-started" | "later";

export const STATUS_LABEL: Record<SetupStatus, string> = {
  done: "Done",
  waiting: "Waiting",
  "not-started": "Not started",
  later: "Later",
};

export const STATUS_TONE = {
  done: "success",
  waiting: "warning",
  "not-started": "neutral",
  later: "info",
} as const;

export interface SetupItem {
  id: string;
  title: string;
  status: SetupStatus;
  /** True when status is detected automatically (env vars, Shopify data, config). */
  auto: boolean;
  who: string;
  why: string;
  where: string;
  /** Env var names involved, with whether each is set. Never values. */
  env?: { name: string; set: boolean; optional?: boolean }[];
  /** Extra plain-text facts (e.g. granted scopes, location address). */
  details?: string[];
}

function esc(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export function checklistHtml(items: SetupItem[], shopName: string): string {
  const rows = items
    .map(
      (it, i) => `
  <tr>
    <td class="n">${i + 1}</td>
    <td><b>${esc(it.title)}</b>
      <div class="why">${esc(it.why)}</div>
      ${it.env?.length ? `<div class="env">${it.env.map((e) => `${esc(e.name)}${e.optional ? " (optional)" : ""}: ${e.set ? "set" : "missing"}`).join(" · ")}</div>` : ""}
      ${it.details?.length ? `<div class="env">${it.details.map(esc).join("<br>")}</div>` : ""}
    </td>
    <td>${esc(it.who)}</td>
    <td>${esc(it.where)}</td>
    <td class="st ${it.status}">${esc(STATUS_LABEL[it.status])}</td>
    <td class="box">☐</td>
  </tr>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Ship Desk — setup checklist</title>
<style>
  body { font-family: Arial, sans-serif; margin: 24px; color: #111; }
  h1 { font-size: 18pt; margin: 0 0 4px; } p { margin: 0 0 16px; color: #555; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  th, td { border: 1px solid #bbb; padding: 6px 8px; vertical-align: top; text-align: left; }
  th { background: #f2f2f2; } .n { width: 20px; } .box { width: 24px; text-align: center; font-size: 14pt; }
  .why { color: #444; margin-top: 2px; } .env { color: #666; font-size: 9pt; margin-top: 4px; }
  .st { font-weight: bold; white-space: nowrap; } .done { color: #0a7a2f; } .waiting { color: #a35d00; }
  .not-started { color: #555; } .later { color: #1f5fa8; }
  @media print { body { margin: 0; } }
</style></head><body>
<h1>Ship Desk — what we need</h1>
<p>${esc(shopName)} · printed ${esc(new Date().toLocaleDateString("en-CA"))} · secrets are never shown here</p>
<table><thead><tr><th>#</th><th>Item</th><th>Who provides it</th><th>Where it goes</th><th>Status</th><th>✓</th></tr></thead>
<tbody>${rows}</tbody></table>
<script>window.onload = function () { window.print(); };</script>
</body></html>`;
}
