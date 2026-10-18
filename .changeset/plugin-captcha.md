---
'better-payment': minor
---

feat(plugins): add captcha plugin supporting Turnstile, reCAPTCHA, and hCaptcha (#173)

- Add `captcha` plugin to verify tokens before payment execution
- Support Cloudflare Turnstile, Google reCAPTCHA v3 (with `minScore`), and hCaptcha
- Read token from HTTP headers or request body candidates
- Normalize failure error codes to `CAPTCHA_MISSING` and `CAPTCHA_INVALID`
- Exclude provider callback and 3DS completion operations
