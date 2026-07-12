import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withRetry } from "../src/retry.js";

function makeStatusError(status: number, message = `status ${status}`): Error {
  const e = new Error(message) as Error & { status: number };
  e.status = status;
  return e;
}

describe("golden retry contracts", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    randomSpy.mockRestore();
    errSpy.mockRestore();
    vi.useRealTimers();
  });

  it("uses exactly 1 initial attempt plus 3 retries with 1000, 2000, and 4000 ms backoff before throwing the last error", async () => {
    const errors = [
      makeStatusError(503, "first"),
      makeStatusError(503, "second"),
      makeStatusError(503, "third"),
      makeStatusError(503, "fourth"),
    ];
    const fn = vi
      .fn()
      .mockRejectedValueOnce(errors[0])
      .mockRejectedValueOnce(errors[1])
      .mockRejectedValueOnce(errors[2])
      .mockRejectedValueOnce(errors[3]);

    const promise = withRetry("golden", fn);
    const settled = expect(promise).rejects.toBe(errors[3]);

    await vi.advanceTimersByTimeAsync(999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1999);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(3999);
    expect(fn).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(4);

    await settled;
    expect(errSpy).toHaveBeenCalledTimes(3);
    expect(errSpy).toHaveBeenNthCalledWith(1, "[immich-mcp] retry 1/3 for golden: first");
    expect(errSpy).toHaveBeenNthCalledWith(2, "[immich-mcp] retry 2/3 for golden: second");
    expect(errSpy).toHaveBeenNthCalledWith(3, "[immich-mcp] retry 3/3 for golden: third");
  });

  it.each([429, 500, 503, 599])("retries status %i", async (status) => {
    const fn = vi.fn().mockRejectedValueOnce(makeStatusError(status)).mockResolvedValueOnce("ok");

    const promise = withRetry("status", fn);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 403, 404, 499, 600])("does not retry status %i", async (status) => {
    const error = makeStatusError(status);
    const fn = vi.fn().mockRejectedValue(error);

    const promise = withRetry("status", fn);
    const settled = expect(promise).rejects.toBe(error);
    await vi.runAllTimersAsync();

    await settled;
    expect(fn).toHaveBeenCalledTimes(1);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("does not retry non-Error throws or Error objects without status", async () => {
    const plain = "plain failure";
    const noStatus = new Error("no status");

    const plainFn = vi.fn().mockRejectedValue(plain);
    const noStatusFn = vi.fn().mockRejectedValue(noStatus);

    const plainPromise = withRetry("plain", plainFn);
    const noStatusPromise = withRetry("no-status", noStatusFn);
    const plainSettled = expect(plainPromise).rejects.toBe(plain);
    const noStatusSettled = expect(noStatusPromise).rejects.toBe(noStatus);
    await vi.runAllTimersAsync();

    await plainSettled;
    await noStatusSettled;
    expect(plainFn).toHaveBeenCalledTimes(1);
    expect(noStatusFn).toHaveBeenCalledTimes(1);
    expect(errSpy).not.toHaveBeenCalled();
  });
});
