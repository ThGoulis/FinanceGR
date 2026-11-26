# FinanceGR Firebase Security & Migration Guide (Sprint 2)

- Requires Firebase Authentication (`auth != null`) and room membership (`owner`, `editor`, `viewer`).
- Keeps existing AES-256-GCM + PBKDF2 payload encryption and supports safe migration from legacy room access.
