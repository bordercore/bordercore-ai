import React from "react";
import { createRoot } from "react-dom/client";
import { ChatStoreProvider } from "../react/stores/ChatStoreContext";
import ChatApp from "../react/ChatApp";
import { EventBus, doGet, doPost } from "../react/utils/reactUtils";
import { library } from "@fortawesome/fontawesome-svg-core";
import {
  faBackward,
  faCheck,
  faChevronUp,
  faCopy,
  faCircleStop,
  faExclamationTriangle,
  faFileAlt,
  faForward,
  faGear,
  faLink,
  faPaperclip,
  faPaperPlane,
  faPaste,
  faPlus,
  faRotateLeft,
} from "@fortawesome/free-solid-svg-icons";

import "../tailwind.css";
import "animate.css";
import "media-chrome";
import "../../static/css/styles.scss";

// Register FontAwesome icons
library.add(
  faBackward,
  faCheck,
  faChevronUp,
  faCopy,
  faCircleStop,
  faExclamationTriangle,
  faFileAlt,
  faForward,
  faGear,
  faLink,
  faPaperclip,
  faPaperPlane,
  faPaste,
  faPlus,
  faRotateLeft
);

// Set up window globals
declare global {
  interface Window {
    EventBus: typeof EventBus;
    doGet: typeof doGet;
    doPost: typeof doPost;
  }
}

window.EventBus = EventBus;
window.doGet = doGet;
window.doPost = doPost;

// Read session data from DOM
const session = JSON.parse(
  document.getElementById("session")!.textContent || "{}"
);
const settings = JSON.parse(
  document.getElementById("settings")!.textContent || "{}"
);
const controlValue = document.getElementById("controlValue")?.textContent || "";

// Mount React app
const container = document.getElementById("app");
if (container) {
  const root = createRoot(container);
  root.render(
    <ChatStoreProvider session={session}>
      <ChatApp session={session} settings={settings} controlValue={controlValue} />
    </ChatStoreProvider>
  );
}
