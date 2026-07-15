import { createHash } from "node:crypto";

/** Stable JSON stringify (sorted keys) for hashing. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function hashParams(params: Record<string, unknown>): string {
  const digest = createHash("sha256").update(stableStringify(params)).digest("hex");
  return `sha256:${digest}`;
}

export function newTicketId(): string {
  const hex = createHash("sha256")
    .update(`${Date.now()}-${Math.random()}`)
    .digest("hex")
    .slice(0, 8);
  return `apr_${hex}`;
}
