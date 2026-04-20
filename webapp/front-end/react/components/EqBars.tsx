import React from "react";

const BAR_COUNT = 7;

export default function EqBars() {
  return (
    <div className="eq-bars" role="status" aria-label="AI thinking">
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <span key={i} className="eq-bar" style={{ animationDelay: `${i * 90}ms` }} />
      ))}
    </div>
  );
}
