import { ok, fail, refuseUnconfirmed } from "@lidless-labs/effect-operator-kit";
import type { Config } from "../config.js";

export class WriteDisabledError extends Error {
  constructor() {
    super(
      "Writes disabled. Set IMMICH_ALLOW_WRITES=true to enable destructive and modifying tools.",
    );
    this.name = "WriteDisabledError";
  }
}

export class ConfirmRequiredError extends Error {
  constructor(toolName: string) {
    // Kit refuseUnconfirmed wording differs; keep this repo's pinned refusal text.
    super(
      `${toolName} is destructive. Pass { confirm: true } in tool args to proceed.`,
    );
    this.name = "ConfirmRequiredError";
  }
}

export function requireWrites(config: Config): void {
  if (!config.allowWrites) {
    throw new WriteDisabledError();
  }
}

export function requireConfirm(toolName: string, confirm: boolean | undefined): void {
  if (confirm !== true) {
    throw new ConfirmRequiredError(toolName);
  }
}

export function surfaceError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const status = (err as unknown as { status?: number; data?: { message?: string } }).status;
  const data = (err as unknown as { data?: { message?: string } }).data;
  const msg = data?.message ?? err.message;
  if (status === undefined) return err.message;
  if (status === 401) return "Immich auth failed - check IMMICH_API_KEY";
  if (status === 403) return `Immich forbidden (status 403) - API key lacks required permission: ${msg}`;
  if (status === 404) return `Immich not found (status 404): ${msg}`;
  if (status === 429) return `Immich rate-limited (status 429): ${msg}`;
  if (status >= 500 && status < 600) return `Immich server error ${status}: ${msg}`;
  return `Immich API ${status}: ${msg}`;
}

/**
 * Success MCP result. Delegates JSON text formatting to kit `ok`, then drops
 * kit's `details` so the observable shape stays content-only (golden contract:
 * no `details`, no `isError`).
 */
export function asMcpResponse(payload: unknown) {
  const kit = ok(payload);
  return { content: kit.content };
}

const CONFIRM_REFUSAL_RE =
  /^(.+) is destructive\. Pass \{ confirm: true \} in tool args to proceed\.$/;

/**
 * Error MCP result. Routes confirm-refusal messages through kit
 * `refuseUnconfirmed` and all other messages through kit `fail` for the
 * isError envelope, while pinning plain-text content.
 *
 * Semantic wraps:
 * - kit `fail("x")` encodes text as JSON `{"error":"x"}`; this repo pins plain `x`.
 * - kit `refuseUnconfirmed(op)` uses different refusal wording; this repo pins
 *   `${op} is destructive. Pass { confirm: true } in tool args to proceed.`
 */
export function asMcpError(message: string) {
  const confirm = CONFIRM_REFUSAL_RE.exec(message);
  const kit = confirm ? refuseUnconfirmed(confirm[1]!) : fail(message);
  return {
    isError: true as const,
    content: kit.content.map((part) =>
      part.type === "text" ? { type: "text" as const, text: message } : part,
    ),
  };
}
