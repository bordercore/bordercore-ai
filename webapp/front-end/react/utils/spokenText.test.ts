import { describe, expect, it, vi } from "vitest";

import { normalizeSpokenText, SPOKEN_TEXT_FILTER_ORDER, SpokenTextStream } from "./spokenText";

describe("normalizeSpokenText", () => {
  it("normalizes Markdown, code, URLs, citations, and emoji without mutating its input", () => {
    const displayed =
      "## Result\nSee [the docs](https://example.com/docs), `npm test`, " +
      "https://example.com/raw [12] 【3†source】 🚀.";

    expect(normalizeSpokenText(displayed)).toBe("Result See the docs, npm test, link .");
    expect(displayed).toContain("[the docs](https://example.com/docs)");
  });

  it("preserves ordinary Unicode text while removing pictographic emoji", () => {
    expect(normalizeSpokenText("Café 東京 naïve — ready ✅")).toBe("Café 東京 naïve — ready");
  });

  it("applies configured do-not-speak patterns and pronunciation overrides", () => {
    const normalized = normalizeSpokenText(
      "BordercoreAI uses a GPU. [internal]trace id 42[/internal]",
      {
        pronunciations: {
          BordercoreAI: "Bordercore A I",
          GPU: "G P U",
        },
        doNotSpeakPatterns: ["\\[internal\\][\\s\\S]*?\\[/internal\\]"],
      }
    );

    expect(normalized).toBe("Bordercore A I uses a G P U.");
  });

  it("supports built-in do-not-speak spans and empty filtered sentences", () => {
    expect(normalizeSpokenText("<nospeak>secret.</nospeak>")).toBe("");
    expect(
      normalizeSpokenText("<!-- tts-ignore-start -->debug<!-- tts-ignore-end --> Speak this.")
    ).toBe("Speak this.");
  });

  it("ignores invalid configured patterns and continues normalizing", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(normalizeSpokenText("Still **works**.", { doNotSpeakPatterns: ["["] })).toBe(
      "Still works."
    );
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });

  it("publishes a stable deterministic filter order", () => {
    expect(SPOKEN_TEXT_FILTER_ORDER).toEqual([
      "do-not-speak",
      "fenced-code",
      "images",
      "links",
      "inline-code",
      "urls",
      "citations",
      "markdown",
      "html",
      "emoji",
      "pronunciations",
      "whitespace",
    ]);
  });
});

describe("SpokenTextStream", () => {
  it("removes fenced code when delimiters are split across streaming chunks", () => {
    const stream = new SpokenTextStream();

    expect(stream.append("Before.\n``")).toBe("Before.\n");
    expect(stream.append("`python\nprint('hidden')\n`")).toBe("");
    expect(stream.append("``\nAfter.")).toBe("\nAfter.");
    expect(stream.finish()).toBe("");
  });
});
