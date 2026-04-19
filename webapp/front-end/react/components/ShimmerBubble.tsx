import React from "react";

export default function ShimmerBubble() {
  return (
    <div className="shimmer-bubble" role="status" aria-label="AI thinking">
      <div className="shimmer-bubble-line shimmer-bubble-line--long" />
      <div className="shimmer-bubble-line shimmer-bubble-line--mid" />
      <div className="shimmer-bubble-line shimmer-bubble-line--short" />
    </div>
  );
}
