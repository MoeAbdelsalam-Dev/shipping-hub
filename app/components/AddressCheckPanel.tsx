import type { AddressType } from "../../carriers/types";
import type { Classification } from "../lib/classifier/types";

const LABEL = { residential: "Residential", commercial: "Commercial", unsure: "Unsure" };
const TONE = { residential: "success", commercial: "info", unsure: "warning" } as const;

interface Props {
  classification: Classification | null;
  checking: boolean;
  error: string | null;
  /** What staff have confirmed for this shipment (null = not yet). */
  confirmed: AddressType | null;
  phone: string | null;
  onCheck: () => void;
  onRecheck: () => void;
  onConfirm: (t: AddressType) => void;
}

/**
 * Shows the automatic address check (verdict, one-line reason, evidence links).
 * It is only a suggestion: nothing changes until staff click Confirm.
 */
export function AddressCheckPanel({
  classification: c,
  checking,
  error,
  confirmed,
  phone,
  onCheck,
  onRecheck,
  onConfirm,
}: Props) {
  const loading = checking ? { loading: true } : {};

  if (!c) {
    return (
      <s-stack gap="small-200">
        <s-button onClick={onCheck} icon="search" {...loading}>
          Check address automatically
        </s-button>
        {error ? <s-text tone="critical">{error}</s-text> : null}
      </s-stack>
    );
  }

  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="small-200">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-text type="strong">Address check:</s-text>
          <s-badge tone={TONE[c.verdict]}>{LABEL[c.verdict]}</s-badge>
          {c.verdict !== "unsure" ? (
            <s-text color="subdued">{Math.round(c.confidence * 100)}% sure</s-text>
          ) : null}
          {c.source === "mock" ? <s-badge tone="neutral">Demo data</s-badge> : null}
        </s-stack>
        <s-text>{c.reason}</s-text>

        {c.evidence.length > 0 ? (
          <s-unordered-list>
            {c.evidence.map((e, i) => (
              <s-list-item key={i}>
                <s-link href={e.url} target="_blank">
                  {e.title || e.url}
                </s-link>
                {e.snippet ? <s-text color="subdued"> — {e.snippet}</s-text> : null}
              </s-list-item>
            ))}
          </s-unordered-list>
        ) : null}

        {c.confirmedType && !confirmed ? (
          <s-text color="subdued">
            Last time staff confirmed this address as {LABEL[c.confirmedType]}.
          </s-text>
        ) : null}

        <s-stack direction="inline" gap="small-200">
          {c.verdict === "unsure" ? (
            <s-banner tone="warning">
              Can&apos;t tell from the web — contact the customer
              {phone ? ` (${phone})` : ""}, then pick below.
            </s-banner>
          ) : confirmed === c.verdict ? (
            <s-badge tone="success" icon="check">
              Confirmed {LABEL[c.verdict]}
            </s-badge>
          ) : (
            <s-button variant="primary" onClick={() => onConfirm(c.verdict as AddressType)}>
              Confirm {LABEL[c.verdict]}
            </s-button>
          )}
          <s-button variant="tertiary" onClick={onRecheck} {...loading}>
            Check again
          </s-button>
        </s-stack>
        {error ? <s-text tone="critical">{error}</s-text> : null}
      </s-stack>
    </s-box>
  );
}
