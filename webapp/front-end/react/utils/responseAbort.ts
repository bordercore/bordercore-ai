export type AbortReason = "manual" | "barge-in" | "replaced";

export class ResponseAbortRegistry {
  private reasons = new WeakMap<AbortController, AbortReason>();

  abort(controller: AbortController, reason: AbortReason): void {
    this.reasons.set(controller, reason);
    controller.abort();
  }

  reasonFor(controller: AbortController): AbortReason {
    return this.reasons.get(controller) || "manual";
  }
}

export function isResponseAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}
