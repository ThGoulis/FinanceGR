import "../styles.css";
import "./admin.css";

// Clickjacking frame-busting guard (Strict CSP — zero inline scripts)
if (window.top !== window.self) {
  try {
    window.top.location = window.self.location;
  } catch {
    document.documentElement.innerHTML = "";
  }
}

// Load isolated FinanceGR Admin Console bundle (including self-tests & admin events)
import "virtual:financegr-admin";
