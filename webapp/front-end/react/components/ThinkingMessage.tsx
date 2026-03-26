import React, { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGear, faChevronUp } from "@fortawesome/free-solid-svg-icons";

interface ThinkingMessageProps {
  text: string;
}

export default function ThinkingMessage({ text }: ThinkingMessageProps) {
  const [showText, setShowText] = useState(false);

  return (
    <div className="flex flex-wrap ml-2">
      <div
        className="control w-auto rounded-md mb-2 p-1 pl-2"
        aria-expanded={showText}
        onClick={() => setShowText(!showText)}
        style={{ cursor: "pointer" }}
      >
        <FontAwesomeIcon icon={faGear} className="gear-icon mr-2" />
        <span className="mr-2">Thinking...</span>
        <FontAwesomeIcon
          icon={faChevronUp}
          className={`toggle-icon mr-1${showText ? " rotated" : ""}`}
        />
      </div>
      {showText && <div>{text}</div>}
      <hr className="mt-3" />
    </div>
  );
}
