import { describe, expect, it } from "vitest";

import { findSpokenTextRange, finishSpokenSegment } from "./spokenHighlight";

describe("findSpokenTextRange", () => {
  it("finds the rendered sentence containing normalized spoken text", () => {
    const rendered = "First sentence. Read the documentation at example.com. Final sentence.";

    const range = findSpokenTextRange(rendered, "Read the documentation.");

    expect(rendered.slice(range!.start, range!.end)).toBe("Read the documentation at example.com.");
  });

  it("continues after the previous segment when phrases repeat", () => {
    const rendered = "This is important. This is important for the second reason.";
    const secondStart = rendered.indexOf("This is important", 1);

    const range = findSpokenTextRange(
      rendered,
      "This is important for the second reason.",
      secondStart
    );

    expect(range?.start).toBe(secondStart);
    expect(rendered.slice(range!.start, range!.end)).toBe(
      "This is important for the second reason."
    );
  });

  it("uses an unchanged word run when pronunciation substitutions differ", () => {
    const rendered = "Qwen3 produces the response quickly. Another sentence.";

    const range = findSpokenTextRange(rendered, "Qwen three produces the response quickly.");

    expect(rendered.slice(range!.start, range!.end)).toBe("Qwen3 produces the response quickly.");
  });
});

describe("finishSpokenSegment", () => {
  const current = { responseId: 12, sequence: 3, text: "Current sentence." };

  it("clears a completed or failed active segment", () => {
    expect(finishSpokenSegment(current, 12, 3)).toBeNull();
  });

  it("does not let a stale completion clear a replacement segment", () => {
    expect(finishSpokenSegment(current, 11, 9)).toBe(current);
    expect(finishSpokenSegment(current, 12, 2)).toBe(current);
  });
});
