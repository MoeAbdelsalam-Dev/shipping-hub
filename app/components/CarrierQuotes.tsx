import { useState } from "react";

import type { Quote } from "../../carriers/types";
import { needsText, type CarrierRow } from "../lib/carrierRows";
import type { MappedFields } from "../lib/rules";

interface Props {
  rows: CarrierRow[];
  quoted: boolean;
  sample: boolean;
  /** Boxes are valid, so a sample label can be drawn. */
  canPreview: boolean;
  onPreviewLabel: (row: CarrierRow, quote: Quote) => void;
}

/** One row per carrier (UPS, Canada Post, OT) with status, quotes and actions. */
export function CarrierQuotes({ rows, quoted, sample, canPreview, onPreviewLabel }: Props) {
  return (
    <s-stack gap="base">
      {rows.map((row) => (
        <s-box key={row.carrierId} padding="base" border="base" borderRadius="base">
          <s-stack gap="small-200">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text type="strong">{row.carrierName}</s-text>
              {row.usual ? <s-badge tone="info">Usual</s-badge> : null}
              {row.poBoxNote === "PO Box → CP" ? <s-badge tone="info">PO Box → CP</s-badge> : null}
              {row.status === "connected" ? <s-badge tone="success">Connected</s-badge> : null}
              {row.status === "not-connected" ? <s-badge tone="neutral">Not connected</s-badge> : null}
              {row.status === "unavailable" ? <s-badge tone="warning">Not available</s-badge> : null}
              {row.status === "error" ? <s-badge tone="critical">Problem</s-badge> : null}
            </s-stack>

            {row.status === "not-connected" ? (
              <s-text color="subdued">
                {needsText(row)}. <s-link href="/app/setup">Setup — what we need</s-link>
              </s-text>
            ) : null}
            {row.message ? <s-text color="subdued">{row.message}</s-text> : null}
            {row.poBoxNote && row.poBoxNote !== "PO Box → CP" ? (
              <s-text color="subdued">{row.poBoxNote}</s-text>
            ) : null}

            {quoted && row.quotes.length === 0 && row.status === "not-connected" && !sample ? (
              <s-text color="subdued">
                No prices until {row.carrierName} is connected — or turn on “Preview with sample
                prices”.
              </s-text>
            ) : null}

            {row.quotes.length > 0 ? (
              <s-table>
                <s-table-header-row>
                  <s-table-header>Service</s-table-header>
                  <s-table-header format="numeric">Days</s-table-header>
                  <s-table-header format="currency">Price (CAD)</s-table-header>
                  <s-table-header>Labels</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {row.quotes.map((q) => {
                    const tipId = `tip-${q.id.replace(/[^a-z0-9]/gi, "-")}`;
                    return (
                      <s-table-row key={q.id}>
                        <s-table-cell>
                          {q.serviceName}
                          {q.sample ? (
                            <>
                              {" "}
                              <s-badge tone="warning">SAMPLE</s-badge>
                            </>
                          ) : null}
                        </s-table-cell>
                        <s-table-cell>{q.transitDays ?? "—"}</s-table-cell>
                        <s-table-cell>${q.totalCad.toFixed(2)}</s-table-cell>
                        <s-table-cell>
                          <s-stack direction="inline" gap="small-200">
                            <s-button disabled interestFor={tipId}>
                              Print labels
                            </s-button>
                            <s-tooltip id={tipId}>
                              {row.status === "connected"
                                ? "Booking is off in this read-only build"
                                : `Available once ${row.carrierName} is connected`}
                            </s-tooltip>
                            {row.fields && canPreview ? (
                              <s-button variant="tertiary" onClick={() => onPreviewLabel(row, q)}>
                                Preview sample label
                              </s-button>
                            ) : null}
                          </s-stack>
                        </s-table-cell>
                      </s-table-row>
                    );
                  })}
                </s-table-body>
              </s-table>
            ) : null}
          </s-stack>
        </s-box>
      ))}
    </s-stack>
  );
}

const FIELD_LABELS: [keyof MappedFields, string][] = [
  ["name", "Name"],
  ["attention", "Attention"],
  ["company", "Company"],
  ["address1", "Address 1"],
  ["address2", "Address 2"],
  ["city", "City"],
  ["provinceCode", "Province"],
  ["postalCode", "Postal code"],
  ["phone", "Phone"],
  ["email", "Email (tracking notices)"],
  ["reference", "Reference"],
  ["residential", "Residential"],
  ["signature", "Signature"],
];

function show(v: MappedFields[keyof MappedFields]): string {
  if (v === null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

/** Collapsible "What each courier will receive" (config/carrier_fields.json). */
export function CourierFieldsPanel({ rows }: { rows: CarrierRow[] }) {
  const [open, setOpen] = useState(false);
  return (
    <s-stack gap="small-200">
      <s-button
        variant="tertiary"
        icon={open ? "chevron-up" : "chevron-down"}
        onClick={() => setOpen((o) => !o)}
      >
        What each courier will receive
      </s-button>
      {open ? (
        <s-table>
          <s-table-header-row>
            <s-table-header>Field</s-table-header>
            {rows.map((r) => (
              <s-table-header key={r.carrierId}>{r.carrierName}</s-table-header>
            ))}
          </s-table-header-row>
          <s-table-body>
            {FIELD_LABELS.map(([key, label]) => (
              <s-table-row key={key}>
                <s-table-cell>{label}</s-table-cell>
                {rows.map((r) => (
                  <s-table-cell key={r.carrierId}>
                    {r.fields ? show(r.fields[key]) : key === "name" ? r.message ?? "—" : "—"}
                  </s-table-cell>
                ))}
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      ) : null}
    </s-stack>
  );
}
