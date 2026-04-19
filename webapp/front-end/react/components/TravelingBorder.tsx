import React from "react";

export default function TravelingBorder() {
  return (
    <div className="traveling-border" role="status" aria-label="AI thinking">
      <div className="traveling-border-inner">
        <span className="traveling-border-dot" />
        <span className="traveling-border-dot" />
        <span className="traveling-border-dot" />
      </div>
    </div>
  );
}
