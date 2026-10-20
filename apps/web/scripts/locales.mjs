// Shared locale registry for the Node scripts (check-translations, docs-content, generate-docs).
// The single source of truth is lib/i18n/locales.json, the same file the app code imports,
// so a language added there needs no script changes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** A locale code is used in URLs, file names and regular expressions, so it is kept strict. */
const CODE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function readLocaleRegistry() {
  const file = fileURLToPath(new URL('../lib/i18n/locales.json', import.meta.url));
  const registry = JSON.parse(readFileSync(file, 'utf8'));
  const codes = Object.keys(registry.languages);
  const defaultLanguage = registry.defaultLanguage;
  if (!codes.length) throw new Error('locales.json: no languages registered');
  if (!codes.includes(defaultLanguage))
    throw new Error(`locales.json: defaultLanguage "${defaultLanguage}" is not a listed language`);
  for (const [code, settings] of Object.entries(registry.languages)) {
    if (!CODE.test(code))
      throw new Error(`locales.json: "${code}" is not a usable locale code (lowercase letters, digits, hyphens)`);
    if (!settings.name || !settings.ogLocale || !settings.intlLocale)
      throw new Error(`locales.json: "${code}" needs name, ogLocale and intlLocale`);
    if (typeof settings.rtl !== 'boolean')
      throw new Error(`locales.json: "${code}" needs a boolean rtl flag`);
    if (settings.docs !== 'required' && settings.docs !== 'optional')
      throw new Error(`locales.json: "${code}" has docs "${settings.docs}", expected "required" or "optional"`);
  }
  return {
    defaultLanguage,
    codes,
    /** every language except the default one (which owns the unprefixed URLs) */
    translated: codes.filter((code) => code !== defaultLanguage),
    /** codes whose docs must be complete; others may be partial and fall back to English */
    required: codes.filter((code) => registry.languages[code].docs === 'required'),
    settings: registry.languages,
  };
}

/** Locale of a content file name: "guides/testing.tr.mdx" → "tr", "guides/testing.mdx" → default */
export function fileLocale(registry, file) {
  const match = /\.([a-z0-9-]{2,8})\.(mdx|json)$/.exec(file.replaceAll('\\', '/'));
  return match && registry.codes.includes(match[1]) ? match[1] : registry.defaultLanguage;
}

/** Adds the URL prefix of a locale: ("tr", "/docs/x") → "/tr/docs/x"; default keeps the path */
export function localeRoute(registry, lang, path) {
  return lang === registry.defaultLanguage ? path : `/${lang}${path}`;
}

/** Locale a route is prefixed with, or the default language for unprefixed routes */
export function routeLocale(registry, route) {
  const segment = route.split('/')[1];
  return registry.translated.includes(segment) ? segment : registry.defaultLanguage;
}
