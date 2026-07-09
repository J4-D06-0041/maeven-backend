# Prepaid Load Research Notes (Philippines)

Date checked: 2026-07-09

## Sources used

- Smart prepaid load page: https://smart.com.ph/prepaid/load
- DITO prepaid page: https://dito.ph/prepaid
- Smart brand portfolio reference: https://en.wikipedia.org/wiki/Smart_Communications
- Globe + TM references: https://en.wikipedia.org/wiki/Globe_Telecom and https://en.wikipedia.org/wiki/TM_(cellular_service)
- TNT reference: https://en.wikipedia.org/wiki/TNT_(cellular_service)
- Sun reference: https://en.wikipedia.org/wiki/Sun_Cellular

## What was extracted reliably

- Smart prepaid load page exposes regular and promo load cards.
- Smart regular load cards shown: 50, 75, 100, 200, 300, 500, 1000.
- Smart promo load cards shown: 200+22, 300+33, 500+55, 1000+150.
- Smart regular load card notes indicate availability to Smart Prepaid and TNT.
- DITO prepaid page exposes detailed prepaid offer prices and validity (Level-Up, Socials, Data Sachets, Unli 5G).

## Known gaps

- Globe official prepaid pages are Cloudflare-protected from this environment and could not be scraped directly.
- TM and TNT public pages are heavily dynamic and do not expose complete denomination tables in server-rendered HTML.
- GOMO public page is SSR Nuxt and did not expose a clean, complete load denomination table in initial HTML.

## Implementation approach in backend

- Added a flexible `prepaid_load_products` catalog so the business can add/update any load product and its `markup_amount` without code changes.
- Seeded products from the two sources where values were directly extractable (Smart and DITO), plus TNT regular load values based on Smart availability note.
- Left room for adding Globe/TM/GOMO entries through API or future seeding once a reliable machine-readable source is available.
