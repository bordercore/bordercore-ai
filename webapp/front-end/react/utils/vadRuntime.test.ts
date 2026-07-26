import { describe, expect, it } from "vitest";

import { describeVadStartupError } from "./vadRuntime";

describe("VAD startup errors", () => {
  it.each([
    ["NotAllowedError", "Microphone permission was denied"],
    ["NotFoundError", "No microphone was found"],
    ["NotReadableError", "The microphone is unavailable or already in use"],
    ["SecurityError", "Microphone access requires a secure connection"],
  ])("describes %s", (name, expected) => {
    expect(describeVadStartupError(new DOMException("", name))).toBe(expected);
  });

  it("recognizes model loading failures without exposing internal errors", () => {
    expect(describeVadStartupError(new Error("Failed to fetch ONNX model asset"))).toBe(
      "The VAD model could not be loaded"
    );
    expect(describeVadStartupError(new Error("unexpected implementation detail"))).toBe(
      "Voice detection could not be started"
    );
  });
});
