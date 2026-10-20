import { source } from "@/lib/source";
import {
  DocsPage,
  DocsBody,
  DocsTitle,
  DocsDescription,
} from "fumadocs-ui/layouts/docs/page";
import { Callout } from "fumadocs-ui/components/callout";
import { flattenTree } from "fumadocs-core/page-tree";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { getMDXComponents } from "@/lib/mdx-components";
import { alternates, isLocale, localePath, type Locale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionary";
import { Since } from "@/components/docs/Since";
import { IS_PRERELEASE, PACKAGE_VERSION, releaseStatus } from "@/lib/release";
import { IS_BETA_DOCS } from "@/lib/base-path";

/** True when the page is shown from the other language because it has no translation */
function isFallback(page: { path: string }, lang: string): boolean {
  const translated = /\.([a-z]{2})\.mdx?$/.exec(page.path)?.[1];
  return lang === "en" ? translated !== undefined : translated !== lang;
}

/**
 * Previous/next links. The EST banks share one page but have an entry each in the sidebar, so on
 * that page the links skip its other entries. Other pages keep Fumadocs' default.
 */
function footerItems(lang: Locale, url: string) {
  const list = flattenTree(source.getPageTree(lang).children);
  const first = list.findIndex((item) => item.url === url);
  let last = first;
  while (first !== -1 && list[last + 1]?.url === url) last++;
  if (last === first) return undefined;
  // Client props: plain fields only (tree nodes carry symbol keys)
  const link = (item?: (typeof list)[number]) => item && { name: item.name, description: item.description, url: item.url };
  return { previous: link(list[first - 1]), next: link(list[last + 1]) };
}

export default async function Page({ params }: PageProps<"/[lang]/docs/[[...slug]]">) {
  const { lang, slug } = await params;
  if (!isLocale(lang)) notFound();
  const page = source.getPage(slug, lang);
  if (!page) notFound();

  const MDX = page.data.body;
  const t = getDictionary(lang).docs;
  const docsPath = `/docs${slug?.length ? `/${slug.join("/")}` : ""}`;
  const inStable = !page.data.since || releaseStatus(page.data.since) === "stable";

  return (
    <DocsPage
      id="main-content"
      tabIndex={-1}
      className="scroll-mt-20 focus:outline-none"
      toc={page.data.toc}
      full={page.data.full}
      footer={{ items: footerItems(lang, page.url) }}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      {page.data.since && <Since version={page.data.since} lang={lang} />}
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        {IS_BETA_DOCS && (
          <Callout type="warn" title={IS_PRERELEASE ? `${t.betaNotice.title} (${PACKAGE_VERSION})` : t.betaNotice.title}>
            {t.betaNotice.install} <code>npm install better-payment@beta</code>.{" "}
            {/* The stable docs are on the same domain; a page added in this beta is not there yet */}
            <a href={localePath(lang, inStable ? docsPath : "/docs")}>{t.betaNotice.link}</a>
          </Callout>
        )}
        {isFallback(page, lang) && <Callout type="info">{t.fallbackNotice}</Callout>}
        <MDX components={getMDXComponents(defaultMdxComponents, lang)} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams("slug", "lang");
}

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/docs/[[...slug]]">): Promise<Metadata> {
  const { lang, slug } = await params;
  if (!isLocale(lang)) notFound();
  const page = source.getPage(slug, lang);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
    alternates: alternates(`/docs${slug?.length ? `/${slug.join("/")}` : ""}`, lang),
  };
}
