import React, { useEffect, useRef, useState } from "react";

const GLYPH_POOL = [
  "ア", "イ", "ウ", "エ", "オ", "カ", "キ", "ク", "ケ", "コ",
  "サ", "シ", "ス", "セ", "ソ", "タ", "チ", "ツ", "テ", "ト",
  "ナ", "ニ", "ヌ", "ネ", "ノ", "ハ", "ヒ", "フ", "ヘ", "ホ",
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
  "A", "B", "C", "D", "E", "F",
  "◊", "◆", "▲", "△", "◇", "⧫", "⟡", "▸", "★", "✦",
  "∆", "∇", "Σ", "Ω", "λ", "φ", "ψ", "≡", "⇌",
  "⠁", "⠃", "⠇", "⠏", "⠟", "⠿", "⡿", "⣿",
];

function randomGlyph(): string {
  return GLYPH_POOL[Math.floor(Math.random() * GLYPH_POOL.length)];
}

interface ScrambleGlyphsProps {
  length?: number;
}

export default function ScrambleGlyphs({ length = 10 }: ScrambleGlyphsProps) {
  const [glyphs, setGlyphs] = useState<string[]>(() =>
    Array.from({ length }, () => randomGlyph())
  );
  const intervalsRef = useRef<number[]>([]);
  const lastSwapRef = useRef<number[]>([]);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    intervalsRef.current = Array.from({ length }, () => 45 + Math.random() * 110);
    lastSwapRef.current = Array.from({ length }, () => performance.now());

    function tick(now: number) {
      setGlyphs((prev) => {
        let changed = false;
        const next = prev.slice();
        for (let i = 0; i < length; i++) {
          if (now - lastSwapRef.current[i] >= intervalsRef.current[i]) {
            next[i] = randomGlyph();
            lastSwapRef.current[i] = now;
            intervalsRef.current[i] = 45 + Math.random() * 110;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [length]);

  return (
    <div className="scramble-glyphs" role="status" aria-label="AI thinking">
      {glyphs.map((g, i) => (
        <span
          key={i}
          className="scramble-glyph"
          style={{ animationDelay: `${(i * 90) % 1400}ms` }}
        >
          {g}
        </span>
      ))}
    </div>
  );
}
