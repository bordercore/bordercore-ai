import { describe, expect, it } from "vitest";

import { isResponseAbort, ResponseAbortRegistry } from "./responseAbort";

describe("ResponseAbortRegistry", () => {
  it("aborts a response with its barge-in reason", () => {
    const registry = new ResponseAbortRegistry();
    const controller = new AbortController();

    registry.abort(controller, "barge-in");

    expect(controller.signal.aborted).toBe(true);
    expect(registry.reasonFor(controller)).toBe("barge-in");
  });

  it("keeps cancellation reasons scoped during response replacement races", () => {
    const registry = new ResponseAbortRegistry();
    const oldResponse = new AbortController();
    const newResponse = new AbortController();

    registry.abort(oldResponse, "replaced");
    registry.abort(newResponse, "barge-in");

    expect(registry.reasonFor(oldResponse)).toBe("replaced");
    expect(registry.reasonFor(newResponse)).toBe("barge-in");
  });

  it("defaults direct browser aborts to manual cancellation", () => {
    const registry = new ResponseAbortRegistry();
    const controller = new AbortController();
    controller.abort();

    expect(registry.reasonFor(controller)).toBe("manual");
  });

  it("treats generic stream errors as cancellation after the response is aborted", () => {
    const controller = new AbortController();
    controller.abort();

    expect(isResponseAbort(new TypeError("Readable stream failed"), controller.signal)).toBe(true);
  });

  it("does not hide genuine errors from an active response", () => {
    const controller = new AbortController();

    expect(isResponseAbort(new TypeError("Network failed"), controller.signal)).toBe(false);
  });
});
