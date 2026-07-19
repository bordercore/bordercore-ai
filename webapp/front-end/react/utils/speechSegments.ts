const MIN_SEGMENT_CHARS = 48;
const TARGET_SEGMENT_CHARS = 180;
const MAX_SEGMENT_CHARS = 320;

/**
 * Incrementally turns a growing LLM response into moderately sized TTS chunks.
 * The caller passes the complete visible response on every update; only newly
 * appended text is inspected.
 */
export class SpeechSegmenter {
  private source = "";
  private pending = "";
  private inCodeFence = false;

  reset() {
    this.source = "";
    this.pending = "";
    this.inCodeFence = false;
  }

  append(fullText: string): string[] {
    let delta: string;
    if (fullText.startsWith(this.source)) {
      delta = fullText.slice(this.source.length);
    } else {
      // Streaming output should only grow. If a provider rewrites it, retain
      // only the new suffix instead of speaking the whole response twice.
      let common = 0;
      const limit = Math.min(this.source.length, fullText.length);
      while (common < limit && this.source[common] === fullText[common]) common++;
      delta = fullText.slice(common);
    }
    this.source = fullText;
    this.pending += this.toSpeakableText(delta);
    return this.takeReady(false);
  }

  finish(fullText?: string): string[] {
    const ready = fullText === undefined ? [] : this.append(fullText);
    return [...ready, ...this.takeReady(true)];
  }

  private toSpeakableText(delta: string): string {
    const output: string[] = [];
    for (const line of delta.split(/(?<=\n)/)) {
      if (line.includes("```")) {
        const pieces = line.split("```");
        for (let i = 0; i < pieces.length; i++) {
          if (!this.inCodeFence) output.push(pieces[i]);
          if (i < pieces.length - 1) this.inCodeFence = !this.inCodeFence;
        }
      } else if (!this.inCodeFence) {
        output.push(line);
      }
    }

    return output
      .join("")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/^\s{0,3}(?:#{1,6}|>|[-*+] |\d+[.)] )\s*/gm, "")
      .replace(/https?:\/\/\S+/g, "link")
      .replace(/[ \t]+/g, " ");
  }

  private takeReady(flush: boolean): string[] {
    const segments: string[] = [];

    while (this.pending.trim()) {
      const boundary = this.findBoundary(flush);
      if (boundary === -1) break;

      const segment = this.pending.slice(0, boundary).replace(/\s+/g, " ").trim();
      this.pending = this.pending.slice(boundary);
      if (segment) segments.push(segment);
    }

    return segments;
  }

  private findBoundary(flush: boolean): number {
    const text = this.pending;
    const strongBoundaries: number[] = [];
    const boundaryPattern = /[.!?](?:["')\]]+)?(?=\s|$)|\n{2,}/g;
    let match: RegExpExecArray | null;
    while ((match = boundaryPattern.exec(text)) !== null) {
      strongBoundaries.push(match.index + match[0].length);
    }

    const preferred = strongBoundaries.find(
      position => position >= MIN_SEGMENT_CHARS && position >= TARGET_SEGMENT_CHARS
    );
    if (preferred !== undefined && preferred <= MAX_SEGMENT_CHARS) return preferred;

    const withinMax = strongBoundaries.filter(position => position <= MAX_SEGMENT_CHARS);
    if (withinMax.length > 0) {
      const last = withinMax[withinMax.length - 1];
      if (last >= MIN_SEGMENT_CHARS || (flush && last === text.length)) return last;
    }

    if (text.length >= MAX_SEGMENT_CHARS) {
      const whitespace = text.lastIndexOf(" ", MAX_SEGMENT_CHARS);
      return whitespace >= MIN_SEGMENT_CHARS ? whitespace + 1 : MAX_SEGMENT_CHARS;
    }

    return flush ? text.length : -1;
  }
}
