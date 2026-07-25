export interface TextRange {
  start: number;
  end: number;
}

export interface ActiveSpokenSegment {
  responseId: number;
  sequence: number;
  text: string;
}

export function finishSpokenSegment(
  current: ActiveSpokenSegment | null,
  responseId: number,
  sequence: number
): ActiveSpokenSegment | null {
  if (current?.responseId === responseId && current.sequence === sequence) return null;
  return current;
}

interface WordToken extends TextRange {
  value: string;
}

function words(text: string, offset = 0): WordToken[] {
  return Array.from(text.matchAll(/[\p{L}\p{N}]+/gu), match => ({
    value: match[0].toLocaleLowerCase(),
    start: offset + match.index!,
    end: offset + match.index! + match[0].length,
  }));
}

function isSentenceBoundary(text: string, index: number): boolean {
  const character = text[index];
  if (character === "\n") return true;
  if (!/[.!?]/.test(character)) return false;
  return index === text.length - 1 || /\s/.test(text[index + 1]);
}

/**
 * Maps normalized spoken text back to the rendered message text. The longest
 * unchanged word run provides an anchor even when links, Markdown, ignored
 * content, or pronunciation substitutions differ. Playback order supplies
 * `fromOffset`, preventing repeated phrases earlier in the response from
 * stealing the match.
 */
export function findSpokenTextRange(
  renderedText: string,
  spokenText: string,
  fromOffset = 0
): TextRange | null {
  const renderedWords = words(renderedText.slice(fromOffset), fromOffset);
  const spokenWords = words(spokenText);
  if (!renderedWords.length || !spokenWords.length) return null;

  let bestLength = 0;
  let bestRenderedEnd = -1;
  let previous = new Array(spokenWords.length + 1).fill(0);

  for (let renderedIndex = 1; renderedIndex <= renderedWords.length; renderedIndex++) {
    const current = new Array(spokenWords.length + 1).fill(0);
    for (let spokenIndex = 1; spokenIndex <= spokenWords.length; spokenIndex++) {
      if (renderedWords[renderedIndex - 1].value === spokenWords[spokenIndex - 1].value) {
        current[spokenIndex] = previous[spokenIndex - 1] + 1;
        if (current[spokenIndex] > bestLength) {
          bestLength = current[spokenIndex];
          bestRenderedEnd = renderedIndex - 1;
        }
      }
    }
    previous = current;
  }

  if (bestLength === 0) return null;
  const firstWord = renderedWords[bestRenderedEnd - bestLength + 1];
  const lastWord = renderedWords[bestRenderedEnd];

  let start = firstWord.start;
  while (start > fromOffset && !isSentenceBoundary(renderedText, start - 1)) start--;
  while (start < renderedText.length && /\s/.test(renderedText[start])) start++;

  let end = lastWord.end;
  while (end < renderedText.length && !isSentenceBoundary(renderedText, end)) end++;
  if (end < renderedText.length && /[.!?]/.test(renderedText[end])) end++;

  return { start, end };
}

export function highlightDomText(
  root: HTMLElement,
  range: TextRange,
  className: string
): () => void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Array<{ node: Text; start: number; end: number }> = [];
  let offset = 0;
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const node = current as Text;
    const start = offset;
    offset += node.data.length;
    nodes.push({ node, start, end: offset });
  }

  const marks: HTMLElement[] = [];
  for (const entry of nodes.reverse()) {
    const overlapStart = Math.max(range.start, entry.start);
    const overlapEnd = Math.min(range.end, entry.end);
    if (overlapStart >= overlapEnd) continue;

    const localStart = overlapStart - entry.start;
    const localEnd = overlapEnd - entry.start;
    const selected = entry.node.splitText(localStart);
    selected.splitText(localEnd - localStart);
    const mark = document.createElement("mark");
    mark.className = className;
    selected.parentNode?.insertBefore(mark, selected);
    mark.appendChild(selected);
    marks.push(mark);
  }

  return () => {
    for (const mark of marks) {
      const parent = mark.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(mark.textContent || ""), mark);
      parent.normalize();
    }
  };
}

export function renderHighlightedHtml(
  sanitizedHtml: string,
  range: TextRange,
  className: string
): string {
  const root = document.createElement("div");
  root.innerHTML = sanitizedHtml;
  highlightDomText(root, range, className);
  return root.innerHTML;
}
