import { describe, expect, it } from "vitest";

import { SpeechSegmenter } from "./speechSegments";

describe("SpeechSegmenter spoken-text integration", () => {
  it("normalizes Markdown constructs split across streaming updates", () => {
    const segmenter = new SpeechSegmenter();

    expect(segmenter.append("Read [the doc")).toEqual([]);
    expect(segmenter.append("Read [the docs](https://example.com/guide) for details.")).toEqual([
      "Read the docs for details.",
    ]);
    expect(segmenter.finish()).toEqual([]);
  });

  it("drops empty normalized segments and preserves later speech", () => {
    const segmenter = new SpeechSegmenter({
      doNotSpeakPatterns: ["\\[quiet\\][\\s\\S]*?\\[/quiet\\]"],
    });

    expect(segmenter.finish("[quiet]Do not say this.[/quiet]\n\nThis should be spoken.")).toEqual([
      "This should be spoken.",
    ]);
  });

  it("applies pronunciations after streaming segmentation", () => {
    const segmenter = new SpeechSegmenter({
      pronunciations: { API: "A P I" },
    });

    expect(segmenter.finish("Use the API.")).toEqual(["Use the A P I."]);
  });
});
