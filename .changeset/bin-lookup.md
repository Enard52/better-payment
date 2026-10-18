---
'better-payment': minor
---

feat(bin): add offline Turkish BIN table lookup (`better-payment/bin`) (#153)

- Add standalone, tree-shakable `lookupBin(bin)` subpath export
- Cover major Turkish bank card families (Bonus, World, Maximum, Axess, CardFinans, Paraf, Bankkart Combo, Sağlam Kart) and prepaid cards
- Zero network latency and zero bundle size impact on the core package
- Add dataset regeneration script and unit tests
