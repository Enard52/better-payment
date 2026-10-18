---
'better-payment': minor
---

feat(plugins): add threeDSTimeout plugin to expire abandoned 3D Secure payments (#180)

- Add `threeDSTimeout` plugin tracking initiated 3D Secure payments across providers
- Support configurable timeout duration (e.g. `'15m'`), pluggable `ThreeDSFlowStore`, and `onExpire` callback
- Query provider before expiring to protect against late successful callbacks
- Provide `payment.threeDS.expireStale()` for serverless and cron schedulers
