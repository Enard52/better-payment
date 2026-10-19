# Better Payment: Web Design Direction

Reference: [craftgate.io](https://craftgate.io/). We borrow its discipline and structure, not its identity. Our palette ("Signal Indigo") already sits close to theirs.

Branch: `feat/homepage-redesign`. Scope for now: **homepage only**. Each step is approved before the next starts.

---

## 1. What Craftgate does well

Extracted from their live CSS and page structure.

| Area | Craftgate | Takeaway for us |
|---|---|---|
| Brand color | `brand-500 #323edd`, full 50 to 950 ramp | One indigo, used sparingly, with a complete ramp |
| Neutrals | Cool gray ramp `#f5f7fa` to `#0e121b` | Blue-tinted grays, never pure gray |
| Type | DM Sans with stylistic sets (`ss02`..`ss07`), IBM Plex Mono for code | One family for UI, one mono for code |
| Letter-spacing | Tightens with size: -0.8px at 40px, -0.96px at 48px, -0.28px at 14px | Tracking is part of the type scale |
| Type scale | Fixed named steps (title-xs 20 → title-4xl 48, body-sm 14 → body-lg 18) with paired line-heights | Use named steps, not one-off sizes |
| Radius | 4 / 6 / 8 / 24 / 36 / pill | Few radii, big ones for hero cards |
| Spacing | 4px base grid (4, 8, 12, 16, 20, 24, 32, 40, 48) | Same |
| Motion | 150ms, `cubic-bezier(.4,0,.2,1)` | Short and quiet |
| Page rhythm | Message → proof → capability → developer → FAQ → content → footer | Trust comes before features |

### Homepage structure (Craftgate)

1. Header: logo, 5 nav items, contact, login
2. Hero: one clear headline, one sentence, one primary CTA, a video trigger
3. Customer logo strip
4. Testimonial from a named executive
5. Award / certification callout
6. "What is it" plus a stats row (years, support, merchants, uptime)
7. Payment method categories ("one integration, access to all")
8. Alternating feature rows (text on one side, product visual on the other)
9. Developer section: SDK cards per language plus a code sample
10. FAQ
11. Blog cards
12. Newsletter
13. Footer: multi-column links, certifications, legal

---

## 2. Where we are now

Current homepage order: Hero → Integrations → Features (bento) → Banks → Contributors → QuickStart → CTA → Footer.

Current tokens (`app/globals.css`): Inter + Manrope (display) + JetBrains Mono, `--primary #4338f2`, `--background #f8f8fc`, `--foreground #13132b`, radius `0.75rem`.

Gaps compared to Craftgate:

- **No type scale.** Sizes are arbitrary values (`text-[2.6rem]`, `text-[14.5px]`, `lg:text-[3.9rem]`).
- **Hero is decorative before it is clear.** Heavy background art and a floating provider network compete with the message.
- **No proof section.** We have no stats row, no "who uses it", no honest trust signals.
- **Features are a uniform card grid.** No alternating rows and no product visuals showing what the library does.
- **One accent ramp missing.** We have `primary`, `tint`, `lilac`, but not a 50 to 950 ramp.

---

## 3. Design principles

1. **Clarity over decoration.** One headline, one sentence, one primary action above the fold.
2. **Proof early.** Numbers and provider logos right after the hero.
3. **Show the product.** Code, API responses and flow diagrams are our "dashboard screenshots".
4. **A system, not a pile of values.** Every size, color, radius and space comes from a token.
5. **Quiet motion.** 150 to 250ms, ease-out. One entrance sequence, no looping decoration.
6. **Honest content.** No invented customers, quotes or numbers. Use real data: provider count, package size, test count, GitHub stars, license.

---

## 4. Tokens (proposed)

### 4.1 Color

Keep the "Signal Indigo" brand. Add a full ramp and cool neutrals.

```
brand-50   #eeedff     brand-500  #4338f2  (primary, unchanged)
brand-100  #e0deff     brand-600  #3a2fe0  (hover, = --bp-primary-hover)
brand-200  #c4c0ff     brand-700  #2f27b8
brand-300  #a9a3ff     brand-800  #251f8f
brand-400  #7f76f8     brand-900  #1b1768
                       brand-950  #13132b  (= foreground)

ink-50  #f8f8fc   ink-100 #f0eff8   ink-200 #e4e3f0   ink-300 #cfcde6
ink-400 #9a99b8   ink-500 #5a5a78   ink-600 #3f3f5c   ink-900 #13132b
```

The existing semantic variables (`--background`, `--card`, `--border`, `--muted-foreground`) stay and point at this ramp, so docs, dark mode and Fumadocs keep working.

Rules:

- Indigo is for actions, links and one highlighted word per headline.
- Surfaces alternate `background` and `card` or `brand-50` to separate sections. No heavy borders between sections.
- Dark sections use `brand-950`, with white text and `brand-400` accents (Craftgate does this in the footer and for emphasis bands).
- Success, warning and danger colors are for status only.

### 4.2 Typography

Keep Inter (UI) and JetBrains Mono (code). Drop Manrope for the homepage unless a headline test shows it clearly helps; fewer families is more professional. Open question in section 8.

Named scale with paired line-height and tracking:

| Token | Size / line | Tracking | Use |
|---|---|---|---|
| `display` | 56 / 60 (40 / 44 on mobile) | -0.035em | Hero h1 only |
| `title-lg` | 40 / 46 | -0.03em | Section h2 |
| `title-md` | 28 / 34 | -0.02em | Feature row h3 |
| `title-sm` | 20 / 28 | -0.01em | Card titles |
| `body-lg` | 18 / 28 | -0.01em | Lead paragraphs |
| `body-md` | 16 / 24 | 0 | Default |
| `body-sm` | 14 / 20 | 0 | Meta, captions |
| `mono-sm` | 13 / 20 | 0 | Code, install command |

Weights: 400 body, 500 UI labels, 600 titles, 700 only for display.

### 4.3 Space, radius, elevation

- Base unit 4px. Section padding: 96px desktop, 64px mobile. Container `max-w-6xl` (1152px), gutters 20px mobile and 32px desktop.
- Radius: `sm 6`, `md 10`, `lg 16`, `xl 24` (hero and showcase cards), `pill` (badges and the primary CTA if we choose it).
- Elevation: borders first (`ink-200`). Shadow only on hover and on floating elements: `0 10px 30px -14px rgb(19 19 43 / .22)`.

### 4.4 Motion

- Standard transition: 150ms `cubic-bezier(.4,0,.2,1)`.
- Entrance and reveal: 400 to 500ms ease-out, 8 to 12px translate, staggered 80 to 110ms. This already exists (`bp-enter`, `bp-reveal`); keep it.
- Respect `prefers-reduced-motion` everywhere.

---

## 5. Components

- **Button**: primary (filled indigo), secondary (outline), tertiary (text link with arrow). One primary per viewport. Height 44px, label 15px/500.
- **Badge**: pill, `brand-50` background, `brand-700` text, 12px/500.
- **Card**: `card` background, 1px `ink-200` border, radius `lg`, padding 24. Hover raises 3px with the soft shadow.
- **Feature row**: two columns, text and visual alternate sides. Visual sits in a `xl`-radius `brand-50` panel.
- **Stat**: large number (`title-lg`, tabular numerals) over a `body-sm` label, in a four-up row with hairline dividers.
- **Logo strip**: grayscale at 60% opacity, full color on hover, one row, auto-scroll only if it overflows.
- **Code block**: mono, dark `brand-950` panel with a language tab and a copy button.

---

## 6. Homepage plan (target order)

| # | Section | Change | Content source |
|---|---|---|---|
| 1 | Navbar | Tidy to 4 links + docs + GitHub + language/theme | Existing |
| 2 | **Hero** | Clear headline, one lead sentence, primary + secondary CTA, install command. Calm background, product visual on the right (code → unified response) | Existing dictionary |
| 3 | **Provider strip** | Real provider logos in one row, directly under the hero | Existing providers |
| 4 | **Stats row** | Provider count, bank count, runtime dependencies, license, etc. Only verifiable numbers | Repo data |
| 5 | **What is Better Payment** | Short definition plus the "one integration, every provider" idea | Existing copy, rewritten |
| 6 | **Feature rows** | Replace the bento grid with alternating rows (unified API, edge footprint, callbacks, idempotency) each with a code or diagram visual | Existing features |
| 7 | **Developer section** | Quick start with install, 3-step code and runtime badges | Existing QuickStart |
| 8 | Banks | Keep, restyle to the new tokens | Existing |
| 9 | Contributors / roadmap | Keep, restyle | Existing |
| 10 | CTA band | Dark `brand-950` band, one action | Existing |
| 11 | Footer | Multi-column links, license, repo links | Existing |

Not copied from Craftgate because we have no real content for it: customer logos, executive testimonial, awards, certifications, blog and newsletter. Add them only when real material exists.

---

## 7. Delivery steps (approval gated)

1. **Foundation**: tokens (color ramp, type scale, radius) in `globals.css`. No visual change to docs.
2. **Hero + Navbar**
3. **Provider strip + stats + "What is"**
4. **Feature rows**
5. **Developer section, Banks, Contributors restyle**
6. **CTA + Footer**
7. QA: light/dark, TR/EN, mobile 375px, Lighthouse, reduced motion.

Each step is a separate commit on this branch. We stop for approval after each one.

---

## 8. Decisions (made by Claude, delegated by the owner)

1. **Fonts**: Inter only on the homepage, Manrope dropped there. JetBrains Mono for code.
2. **Buttons**: keep the rounded rectangle (10 to 14px radius). Pills read as consumer apps, not infrastructure.
3. **Hero visual**: code → unified response, replacing the provider network from step 2 on.
4. **Stats**: only verifiable numbers (provider count, bank count, runtime dependencies, license).
5. **Navigation**: premium SaaS style mega menu (Product, Providers, Developers, Resources, plus a direct Docs link). Hover or click opens a full-width panel with icon + title + description rows and a featured card. Mobile uses an accordion.

## 9. Progress

- [x] Step 2a: Navbar mega menu, reworked to the Craftgate grammar (intro column + categorised groups + dimmed page). `components/Navbar.tsx`, `lib/nav-menu.ts`, `nav.menu` in the dictionary (EN + TR)
- [ ] Step 1: tokens (color ramp, type scale)
- [ ] Hero, provider strip, stats, feature rows, developer section, CTA, footer
