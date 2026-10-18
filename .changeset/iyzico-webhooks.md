---
'better-payment': minor
---

feat(iyzico): add webhook signature verification and handler route (#150)

- Add `verifyWebhook(headers, body)` to `IyzicoProvider` with `X-IYZ-SIGNATURE-V3` HMAC-SHA256 verification
- Expose `/api/pay/iyzico/webhook` route in `BetterPaymentHandler` with `onWebhook` hook and idempotency cache support
