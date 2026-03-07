import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/lora/latin-400.css";
import "@fontsource/lora/latin-400-italic.css";
import "@fontsource/lora/latin-500.css";
import "@fontsource/lora/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import { App } from "./app";
import "./index.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Side panel root not found");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
