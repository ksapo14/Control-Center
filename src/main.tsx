import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

const startupSplash = document.getElementById("app-startup-splash");
if (startupSplash) {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        startupSplash.setAttribute("aria-hidden", "true");
        startupSplash.classList.add("is-leaving");
        window.setTimeout(() => startupSplash.remove(), reduceMotion ? 90 : 280);
      }, reduceMotion ? 80 : 620);
    });
  });
}
