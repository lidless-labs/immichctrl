import { Cause, Effect, Exit } from "effect";
import {
  exponentialRetry,
  withRetry as withKitRetry,
  type OperatorError,
} from "@lidless-labs/effect-operator-kit";

const BACKOFF_MS = [1000, 2000, 4000];

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const status = (err as unknown as { status?: number }).status;
  if (status === undefined) return false;
  return status === 429 || (status >= 500 && status < 600);
}

function jitter(ms: number): number {
  return ms + Math.floor(Math.random() * 500);
}

export async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  const policy = exponentialRetry({
    maxAttempts: BACKOFF_MS.length + 1,
    initialDelayMs: 0,
    maxDelayMs: 0,
    factor: 1,
    jitter: false,
    shouldRetry: (err) => isRetryable(err),
  });

  const effect = Effect.tryPromise({
    try: async () => {
      try {
        return await fn();
      } catch (e) {
        const currentAttempt = attempt++;
        if (currentAttempt >= BACKOFF_MS.length || !isRetryable(e)) throw e;

        const msg = e instanceof Error ? e.message : String(e);
        console.error(
          `[immich-mcp] retry ${currentAttempt + 1}/${BACKOFF_MS.length} for ${label}: ${msg}`,
        );
        const wait = jitter(BACKOFF_MS[currentAttempt]!);
        await new Promise((resolve) => setTimeout(resolve, wait));
        throw e;
      }
    },
    catch: (e) => e as OperatorError,
  });

  const exit = await Effect.runPromiseExit(withKitRetry(effect, policy));
  if (Exit.isSuccess(exit)) return exit.value;

  const failure = Cause.failureOption(exit.cause);
  if (failure._tag === "Some") throw failure.value;
  throw Cause.squash(exit.cause);
}
