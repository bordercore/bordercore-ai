import MarkdownIt from "markdown-it";
import hljs from "highlight.js";
import { katex } from "@mdit/plugin-katex";
import DOMPurify from "dompurify";

import "highlight.js/styles/dracula.css";

// highlightAuto's relevance scoring mis-labels short Python snippets as C++,
// so restrict auto-detection to languages likely to appear in AI chat responses
// and exclude C-family grammars that tend to false-positive.
const AUTO_DETECT_LANGUAGES = [
  "python",
  "javascript",
  "typescript",
  "bash",
  "shell",
  "json",
  "yaml",
  "html",
  "xml",
  "css",
  "scss",
  "sql",
  "rust",
  "go",
  "ruby",
  "markdown",
  "dockerfile",
  "ini",
  "diff",
];

const markdown = MarkdownIt({
  highlight: function (str: string, lang: string) {
    let highlighted: string;
    let languageClass = "";
    try {
      if (lang && hljs.getLanguage(lang)) {
        highlighted = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
        languageClass = ` language-${lang}`;
      } else {
        const auto = hljs.highlightAuto(str, AUTO_DETECT_LANGUAGES);
        highlighted = auto.value;
        if (auto.language) languageClass = ` language-${auto.language}`;
      }
    } catch (__) {
      highlighted = markdown.utils.escapeHtml(str);
    }
    return `<pre class="hljs"><code class="hljs${languageClass}">${highlighted}</code></pre>`;
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
