export interface SpokenTextConfig {
  pronunciations?: Record<string, string>;
  doNotSpeakPatterns?: string[];
}

export const SPOKEN_TEXT_FILTER_ORDER = [
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
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replacePronunciations(text: string, pronunciations: Record<string, string>): string {
  const entries = Object.entries(pronunciations)
    .filter(([written, spoken]) => written.length > 0 && spoken.length > 0)
    .sort(([left], [right]) => right.length - left.length || left.localeCompare(right));

  for (const [written, spoken] of entries) {
    const expression = new RegExp(
      `(?<![\\p{L}\\p{N}_])${escapeRegExp(written)}(?![\\p{L}\\p{N}_])`,
      "giu"
    );
    text = text.replace(expression, spoken);
  }
  return text;
}

/**
 * Normalize text for speech without changing the displayed assistant message.
 *
 * Filters deliberately run in SPOKEN_TEXT_FILTER_ORDER. Custom patterns come
 * from trusted server configuration and are treated as JavaScript regexes.
 */
export function normalizeSpokenText(text: string, config: SpokenTextConfig = {}): string {
  let spoken = text;

  for (const pattern of config.doNotSpeakPatterns ?? []) {
    try {
      spoken = spoken.replace(new RegExp(pattern, "giu"), "");
    } catch (error) {
      console.warn(`Ignoring invalid TTS do-not-speak pattern ${JSON.stringify(pattern)}`, error);
    }
  }

  spoken = spoken
    .replace(/<(?:nospeak|tts-ignore)\b[^>]*>[\s\S]*?<\/(?:nospeak|tts-ignore)>/giu, "")
    .replace(/<!--\s*tts-ignore-start\s*-->[\s\S]*?<!--\s*tts-ignore-end\s*-->/giu, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/https?:\/\/[^\s<]+/giu, "link")
    .replace(/(?:\[\d+(?:[,\s-]+\d+)*\]|【[^】]*†[^】]*】)/gu, "")
    .replace(/^\s{0,3}(?:#{1,6}\s*|>\s*|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/[*_~]{1,3}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu, "");

  spoken = replacePronunciations(spoken, config.pronunciations ?? {});
  return spoken.replace(/\s+/g, " ").trim();
}

/**
 * Removes fenced code from incrementally arriving Markdown. A one- or
 * two-backtick suffix is held until the next chunk so a split ``` delimiter is
 * never spoken.
 */
export class SpokenTextStream {
  private inCodeFence = false;
  private carry = "";

  reset(): void {
    this.inCodeFence = false;
    this.carry = "";
  }

  append(delta: string): string {
    const input = this.carry + delta;
    this.carry = "";

    const trailingTicks = input.match(/`{1,2}$/)?.[0] ?? "";
    const complete = trailingTicks ? input.slice(0, -trailingTicks.length) : input;
    this.carry = trailingTicks;

    return this.consume(complete);
  }

  finish(): string {
    const output = this.inCodeFence ? "" : this.carry;
    this.carry = "";
    return output;
  }

  private consume(input: string): string {
    const output: string[] = [];
    let cursor = 0;

    while (cursor < input.length) {
      const fence = input.indexOf("```", cursor);
      if (fence === -1) {
        if (!this.inCodeFence) output.push(input.slice(cursor));
        break;
      }
      if (!this.inCodeFence) output.push(input.slice(cursor, fence));
      this.inCodeFence = !this.inCodeFence;
      cursor = fence + 3;
    }

    return output.join("");
  }
}
