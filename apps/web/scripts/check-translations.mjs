// Checks that the translated docs stay in sync with the English ones, for every
// language registered in lib/i18n/locales.json:
//
// - languages with docs "required" (Turkish today): every page (x.mdx) has a translation
//   (x.tr.mdx) and vice versa; same for meta.json
// - languages with docs "optional": missing pages are allowed (a reader falls back to
//   English with a notice), but every page that exists must hold the same rules as below,
//   and progress is reported per locale, e.g. `de: 12/27 pages`
// - code blocks are identical and in the same order (code is shared, only prose is translated)
// - headings have the same levels, and each translated heading keeps the English heading's
//   id (`## Başlık [#english-id]`), so links and anchors work in every language
//
// Usage: node scripts/check-translations.mjs [--fix]
//   --fix adds or corrects the `[#id]` of translated headings.
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLocaleRegistry } from './locales.mjs';

const ROOT = fileURLToPath(new URL('../content/docs/', import.meta.url));
const FIX = process.argv.includes('--fix');
const registry = readLocaleRegistry();

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const FENCE = /^([ \t]*)(```|~~~)/;

/** Splits a page into lines, marking which ones are inside code blocks */
function parse(source) {
  const lines = source.split('\n');
  const blocks = [];
  const headings = [];
  let fence = null;
  let current = [];
  lines.forEach((line, index) => {
    const match = FENCE.exec(line);
    if (fence) {
      current.push(line);
      if (match && match[1] === fence.indent && match[2] === fence.marker) {
        blocks.push(current.join('\n'));
        fence = null;
      }
      return;
    }
    if (match) {
      fence = { indent: match[1], marker: match[2] };
      current = [line];
      return;
    }
    const heading = /^(#{2,6})\s+(.*?)\s*$/.exec(line);
    if (heading) headings.push({ index, level: heading[1].length, text: heading[2] });
  });
  return { lines, blocks, headings };
}

/** github-slugger, as used by fumadocs for heading ids */
function slugger() {
  const seen = new Map();
  return (text) => {
    const plain = text
      .replace(/\s*\[#[^\]]+\]\s*$/, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[`*]/g, '');
    let slug = plain
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
      .replace(/ /g, '-');
    const base = slug;
    let count = seen.get(base) ?? 0;
    while (seen.has(slug) && count > 0) slug = `${base}-${count++}`;
    if (seen.has(slug)) slug = `${base}-${count++}`;
    seen.set(base, count + (slug === base ? 1 : 0));
    seen.set(slug, seen.get(slug) ?? 1);
    return slug;
  };
}

function explicitId(text) {
  return /\[#([^\]]+)\]\s*$/.exec(text)?.[1];
}

const problems = [];
const files = walk(ROOT).map((path) => relative(ROOT, path)).filter((file) => /\.(mdx|json)$/.test(file));
let fixed = 0;

/** English pages: the content files without any registered locale suffix */
const baseFiles = files.filter((file) => {
  const match = /\.([a-z0-9-]{2,8})\.(mdx|json)$/.exec(file);
  return !match || !registry.codes.includes(match[1]);
});

const progress = [];

for (const locale of registry.translated) {
  const required = registry.required.includes(locale);
  const suffix = new RegExp(`\\.${locale}\\.(mdx|json)$`);

  for (const file of files) {
    const isTranslation = suffix.test(file);
    if (isTranslation) {
      const counterpart = file.replace(`.${locale}.`, '.');
      if (!existsSync(join(ROOT, counterpart)))
        problems.push(`${file}: no English page ${counterpart}`);
    } else if (required && baseFiles.includes(file)) {
      const counterpart = file.replace(/\.(mdx|json)$/, `.${locale}.$1`);
      if (!existsSync(join(ROOT, counterpart)))
        problems.push(`${file}: missing ${locale} translation ${counterpart}`);
    }
  }

  const basePages = baseFiles.filter((file) => file.endsWith('.mdx'));
  const translatedPages = basePages.filter((file) =>
    existsSync(join(ROOT, file.replace(/\.mdx$/, `.${locale}.mdx`)))
  );
  progress.push(`${locale}: ${translatedPages.length}/${basePages.length} pages`);

  for (const file of translatedPages) {
    const trFile = file.replace(/\.mdx$/, `.${locale}.mdx`);
    const en = parse(readFileSync(join(ROOT, file), 'utf8'));
    const trSource = readFileSync(join(ROOT, trFile), 'utf8');
    const tr = parse(trSource);

    if (en.blocks.length !== tr.blocks.length) {
      problems.push(`${trFile}: ${tr.blocks.length} code blocks, English has ${en.blocks.length}`);
    } else {
      en.blocks.forEach((block, i) => {
        if (block !== tr.blocks[i]) problems.push(`${trFile}: code block ${i + 1} differs from ${file}`);
      });
    }

    if (en.headings.length !== tr.headings.length) {
      problems.push(`${trFile}: ${tr.headings.length} headings, English has ${en.headings.length}`);
      continue;
    }
    const slug = slugger();
    let changed = false;
    en.headings.forEach((enHeading, i) => {
      const trHeading = tr.headings[i];
      const id = explicitId(enHeading.text) ?? slug(enHeading.text);
      if (trHeading.level !== enHeading.level) {
        problems.push(`${trFile}: heading ${i + 1} is h${trHeading.level}, English is h${enHeading.level}`);
        return;
      }
      if (explicitId(trHeading.text) === id) return;
      const localSlug = slugger()(trHeading.text);
      if (!explicitId(trHeading.text) && localSlug === id) return; // same text, same id
      if (FIX) {
        const text = trHeading.text.replace(/\s*\[#[^\]]+\]\s*$/, '');
        tr.lines[trHeading.index] = `${'#'.repeat(trHeading.level)} ${text} [#${id}]`;
        changed = true;
        fixed++;
      } else {
        problems.push(`${trFile}: heading "${trHeading.text}" should end with [#${id}]`);
      }
    });
    if (changed) writeFileSync(join(ROOT, trFile), tr.lines.join('\n'));
  }
}

// Frontmatter values are plain YAML scalars: a second ": " makes the page fail to build
for (const file of baseFiles.filter((f) => f.endsWith('.mdx'))) {
  for (const name of [file, ...registry.translated.map((locale) => file.replace(/\.mdx$/, `.${locale}.mdx`))]) {
    if (!existsSync(join(ROOT, name))) continue;
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(readFileSync(join(ROOT, name), 'utf8'))?.[1] ?? '';
    for (const line of frontmatter.split('\n')) {
      const value = /^[\w-]+:\s*(.*)$/.exec(line)?.[1] ?? '';
      if (!/^["']/.test(value) && /: |:$/.test(value)) {
        problems.push(`${name}: frontmatter "${line}" has an unquoted ": " (quote the value or use "—")`);
      }
    }
  }
}

if (FIX && fixed) console.log(`Fixed ${fixed} heading id(s).`);
for (const line of progress) console.log(line);
if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'));
  console.error(`\n${problems.length} translation problem(s). See CONTRIBUTING.md → Translations.`);
  process.exit(1);
}
const nameOf = (code) => registry.settings[code].name;
const partialCodes = registry.translated.filter((code) => !registry.required.includes(code));
console.log(
  `✓ Every docs page is available in ${registry.required.map(nameOf).join(', ')}, ` +
    'with matching code blocks and heading ids' +
    (partialCodes.length
      ? `; ${partialCodes.join(', ')} ${partialCodes.length === 1 ? 'is' : 'are'} partial and checked page by page.`
      : '.')
);
