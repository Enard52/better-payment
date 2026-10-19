import { defineI18n } from "fumadocs-core/i18n";
import locales from "./locales.json";

/**
 * Per-language settings. Everything the site knows about its languages comes from
 * `lib/i18n/locales.json`: URLs, redirects, the switcher menu, the sitemap, hreflang
 * alternates and the translation checks are all derived from it, so adding a language
 * is a config change, not a code change (see TRANSLATIONS.md → Adding a language).
 */
export interface LocaleSettings {
  /** the language's own name, used by the navbar switcher and the generated llms index */
  name: string;
  /** Open Graph locale tag, e.g. "en_US" */
  ogLocale: string;
  /** BCP 47 tag for Intl.DateTimeFormat, e.g. "en-US" */
  intlLocale: string;
  /** right-to-left script; sets dir="rtl" on <html>. Layout mirroring is a follow-up. */
  rtl: boolean;
  /** "required": every docs page must exist; "optional": missing pages fall back to English */
  docs: string;
}

const settings = locales.languages;

export type Locale = keyof typeof settings;

export const LOCALES = Object.keys(settings) as Locale[];
export const DEFAULT_LOCALE: Locale = locales.defaultLanguage as Locale;

/**
 * English is the default and keeps the unprefixed URLs (`/docs/...`), so existing
 * links keep working. Other languages live under `/<code>/...`.
 */
export const i18n = defineI18n({
  languages: LOCALES,
  defaultLanguage: DEFAULT_LOCALE,
  hideLocale: "default-locale",
  parser: "dot",
  // A page missing in one language falls back to English (with a notice)
  fallbackLanguage: DEFAULT_LOCALE,
});

export const LOCALE_COOKIE = "bp_locale";
export const SITE_URL = "https://better-payment.czaylabs.com";

/** Display names of every locale, from the registry */
export const LOCALE_NAMES: Record<Locale, string> = Object.fromEntries(
  LOCALES.map((lang) => [lang, settings[lang].name])
) as Record<Locale, string>;

/** Per-locale settings (name, ogLocale, intlLocale, rtl, docs) */
export function localeSettings(lang: Locale): LocaleSettings {
  return settings[lang];
}

/** Open Graph locale tag for a language, e.g. "en_US" */
export function openGraphLocale(lang: Locale): string {
  return settings[lang].ogLocale;
}

/** True for right-to-left languages (`<html dir="rtl">`) */
export function isRtl(lang: Locale): boolean {
  return settings[lang].rtl;
}

export function isLocale(value: string | undefined): value is Locale {
  return value !== undefined && (LOCALES as string[]).includes(value);
}

/**
 * Picks the text written for a language, falling back to English for languages that
 * do not have their own copy yet. Keep the `en` entry complete; it is the fallback.
 */
export function localeText<T>(texts: { en: T } & Partial<Record<Locale, T>>, lang: Locale): T {
  return texts[lang] ?? texts.en;
}

/** Adds the locale prefix to an internal path: ("tr", "/docs") → "/tr/docs" */
export function localePath(lang: Locale, path: string): string {
  if (!path.startsWith("/") || lang === DEFAULT_LOCALE) return path;
  if (path === "/") return `/${lang}`;
  if (path.startsWith("/#")) return `/${lang}${path.slice(1)}`;
  return `/${lang}${path}`;
}

/** Matches a leading locale segment for any registered language */
const localePrefix = new RegExp(`^\\/(${LOCALES.map((code) => code.replace(/[^a-z0-9-]/gi, "")).join("|")})(?=\\/|$)`);

/** Removes a locale prefix: "/tr/docs/x" → "/docs/x" */
export function stripLocale(path: string): string {
  const match = localePrefix.exec(path);
  if (!match) return path;
  return path.slice(match[0].length) || "/";
}

/** hreflang alternates for a path without locale prefix */
export function alternates(path: string, lang: Locale) {
  const clean = stripLocale(path);
  return {
    canonical: localePath(lang, clean),
    languages: {
      ...Object.fromEntries(LOCALES.map((code) => [code, localePath(code, clean)])),
      "x-default": localePath(DEFAULT_LOCALE, clean),
    },
  };
}
