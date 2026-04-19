import React from "react";
import { WaitingAnimation } from "../stores/ChatStoreContext";
import TokenStream from "./TokenStream";
import ScrambleGlyphs from "./ScrambleGlyphs";
import TypingDots from "./TypingDots";
import ShimmerBubble from "./ShimmerBubble";
import TravelingBorder from "./TravelingBorder";
import EqBars from "./EqBars";
import RadarSweep from "./RadarSweep";

interface WaitingIndicatorProps {
  animation: WaitingAnimation;
}

export default function WaitingIndicator({ animation }: WaitingIndicatorProps) {
  switch (animation) {
    case "spinner":
      return (
        <div
          className="waiting-spinner ml-3 h-5 w-5 animate-spin rounded-full border-2 border-bs-info border-t-transparent"
          role="status"
          aria-label="AI thinking"
        />
      );
    case "tokenStream":
      return <TokenStream />;
    case "scramble":
      return <ScrambleGlyphs />;
    case "typingDots":
      return <TypingDots />;
    case "shimmerBubble":
      return <ShimmerBubble />;
    case "travelingBorder":
      return <TravelingBorder />;
    case "eqBars":
      return <EqBars />;
    case "radarSweep":
      return <RadarSweep />;
    default:
      return <TokenStream />;
  }
}
