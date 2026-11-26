import "../styles.css";

// Clickjacking frame-busting guard (replaces inline <script> for Strict CSP)
if (window.top !== window.self) {
  try {
    window.top.location = window.self.location;
  } catch {
    document.documentElement.innerHTML = "";
  }
}

// Register PWA Service Worker
if (
  "serviceWorker" in navigator &&
  (window.location.protocol === "https:" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost")
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((err) => {
      console.warn("SW registration skipped:", err);
    });
  });
}

// Load bundled FinanceGR core application & delegated event engine
import "virtual:financegr-app";
