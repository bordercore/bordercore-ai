import MarkdownIt from "markdown-it";
import hljs from "highlight.js";
import { katex } from "@mdit/plugin-katex";
import DOMPurify from "dompurify";

import "highlight.js/styles/dracula.css";

const markdown = MarkdownIt({
  highlight: function (str: string) {
    try {
      return hljs.highlightAuto(str).value;
    } catch (__) {}
    return "";
  },
});

markdown.use(katex, {
  throwOnError: false,
  errorColor: "#cc0000",
});

/**
 * Render markdown content to sanitized HTML.
 * Normalizes math delimiters for KaTeX and sanitizes output with DOMPurify.
 */
export function renderMarkdown(content: string): string {
  // Normalize math delimiters: remove spaces around dollar signs for KaTeX
  const normalizedContent = content.replace(
    /\$\s+([^$]+?)\s+\$/g,
    (_match, mathContent: string) => `$${mathContent.trim()}$`
  );
  const rawHtml = markdown.render(normalizedContent);
  return DOMPurify.sanitize(rawHtml);
}

export default markdown;
