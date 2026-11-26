# FinanceGR Quotes & FX Worker (Sprint 2)

- **No hardcoded FX fallback rates:** If FX providers fail or data exceeds freshness limits, conversion is marked `unavailable` instead of falling back to static rates.
- **FX Freshness Policy:**
  - `<= 6h`: `fresh` (`stale: false`)
  - `6h - 24h`: `stale` (`stale: true`)
  - `> 24h` or provider failure: `unavailable`
- **Deploy:** `npx wrangler deploy --config wrangler.toml.example` (after setting your route/account in Cloudflare).
