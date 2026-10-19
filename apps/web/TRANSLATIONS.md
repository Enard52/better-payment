# Docs translations / Doküman çevirileri

The website and docs are published in English (default, `/docs/...`) and Turkish (`/tr/docs/...`).
More languages are supported: everything the site knows about languages comes from one registry file, `lib/i18n/locales.json`. URLs, redirects, the navbar language menu, the sitemap, hreflang alternates, the generated docs and the CI checks are all derived from it.

## Files

| What | English | Turkish | A new language |
| ---- | ------- | ------- | -------------- |
| Language registry | `lib/i18n/locales.json` | `lib/i18n/locales.json` | one entry in `lib/i18n/locales.json` |
| Docs page | `content/docs/<path>.mdx` | `content/docs/<path>.tr.mdx` | `content/docs/<path>.<code>.mdx` |
| Sidebar titles and order | `content/docs/<dir>/meta.json` | `content/docs/<dir>/meta.tr.json` | `content/docs/<dir>/meta.<code>.json` |
| Homepage and site texts | `lib/i18n/dictionary.ts` (`en`) | `lib/i18n/dictionary.ts` (`tr`) | a partial dictionary in `lib/i18n/dictionary.ts` |
| Docs UI labels (search, TOC, …) | fumadocs defaults | `lib/i18n/ui.ts` | optional overrides in `lib/i18n/ui.ts` |

## Adding a language / Dil ekleme

Adding a language is a config change, not a code change:

1. **`lib/i18n/locales.json`** — add one entry under `languages`, keyed by the locale code used in URLs and file names (`"de": { … }`):
   - `name`: the language's own name (`"Deutsch"`); it feeds the navbar switcher and the generated `llms.txt`.
   - `ogLocale`: the Open Graph tag (`"de_DE"`); `intlLocale`: the BCP 47 tag used for dates (`"de-DE"`).
   - `rtl`: `true` for right-to-left scripts (Arabic). It sets `dir="rtl"` on `<html>`; docs are written LTR regardless. Mirroring the homepage and docs layouts for RTL is a separate follow-up.
   - `docs`: `"required"` means every page must have a translation (Turkish today). `"optional"` — the usual choice to start — lets a language ship with zero or a few pages: untranslated pages fall back to English with the existing notice, and the pages that do exist are checked just as strictly.
2. **`lib/i18n/dictionary.ts`** — add a partial dictionary and register it in `translations`. Keys you omit fall back to English per key, so you can translate the homepage later. Always provide `docs.fallbackNotice` (readers of a not-yet-translated page see it) and the `meta` block (page titles and descriptions).
3. **Translate pages** as `content/docs/<path>.<code>.mdx` (plus `meta.<code>.json`), one directory at a time. Progress per language is printed by `node scripts/check-translations.mjs` (`de: 12/38 pages`).
4. Optional: docs UI labels (search, "On this page", …) in `lib/i18n/ui.ts`; languages without entries keep fumadocs' English defaults.

No other file has to change. Flip `docs` to `"required"` when the language is fully translated; CI then enforces page parity like it does for Turkish.

## Rules

1. **Translate prose only.** Code blocks are shared: keep them byte-for-byte identical to the English page, including comments. This applies to every locale, including partial ones.
2. **Keep the structure.** Same headings (same levels, same order), same tables and callouts. Every translated heading keeps the English heading's id: `## Taksit [#installments]`. Run `node scripts/check-translations.mjs --fix` to add the ids.
3. **Links** to other docs pages are written without a locale (`/docs/concepts/testing`); they are localized automatically.
4. **Frontmatter** values must not contain a second `: `. Use `—` or quote the value.
5. When you change an English page, update its Turkish page in the same PR (and vice versa). A page without a translation falls back to English with a notice. For `docs: "required"` languages CI rejects the missing page; for `docs: "optional"` languages it only reports progress.

```bash
cd apps/web
node scripts/check-translations.mjs        # what CI runs
node scripts/check-translations.mjs --fix  # add/fix heading ids
```

## Glossary / Terimler

Keep a glossary per language under this section. Code identifiers (`capture()`, `paymentId`, …) are never translated in any language.

### Turkish / Türkçe

| English | Türkçe |
| ------- | ------ |
| payment provider / gateway | ödeme sağlayıcısı |
| payment institution | ödeme kuruluşu |
| virtual POS | sanal POS |
| merchant | üye işyeri |
| pre-authorization | ön provizyon |
| capture | capture (provizyon kapama) |
| void | void / iptal |
| refund / partial refund | iade / kısmi iade |
| cancel | iptal |
| installment | taksit |
| stored card / tokenization | kayıtlı kart / tokenizasyon |
| callback | callback |
| notification (PayTR) | bildirim |
| order id | sipariş numarası |
| request / response | istek / yanıt |
| request validation | istek doğrulama |
| error code | hata kodu |
| retry | yeniden deneme |
| edge runtime | edge ortamı |
| handler, adapter, route, hook, token, sandbox | (English term kept) |
| plugin, endpoint | (English term kept) |
| payment event / listener | ödeme olayı / dinleyici |
| payment object | ödeme nesnesi |
| custom provider | özel sağlayıcı |
| non-3D | 3D'siz |
