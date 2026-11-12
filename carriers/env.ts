/** Env helpers for adapters. Never return or log secret values. */

export function missingEnv(names: string[]): string[] {
  return names.filter((n) => !process.env[n]?.trim());
}

export function hasAllEnv(names: string[]): boolean {
  return missingEnv(names).length === 0;
}

/** "sandbox" unless the *_ENV variable says "production". */
export function carrierEnv(name: string): "sandbox" | "production" {
  return process.env[name]?.trim().toLowerCase() === "production" ? "production" : "sandbox";
}

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not built yet`);
    this.name = "NotImplementedError";
  }
}
