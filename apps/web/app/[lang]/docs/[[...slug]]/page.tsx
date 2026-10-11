import { source } from "@/lib/source";
import {
  DocsPage,
  DocsBody,
  DocsTitle,
  DocsDescription,
} from "fumadocs-ui/layouts/docs/page";
import { Callout } from "fumadocs-ui/components/callout";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { getMDXComponents } from "@/lib/mdx-components";
import { alternates, isLocale, localePath, SITE_URL } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionary";
import { Since } from "@/components/docs/Since";
import { IS_PRERELEASE, PACKAGE_VERSION } from "@/lib/release";

/** True when the page is shown from the other language because it has no translation */
function isFallback(page: { path: string }, lang: string): boolean {
  const translated = /\.([a-z]{2})\.mdx?$/.exec(page.path)?.[1];
  return lang === "en" ? translated !== undefined : translated !== lang;
}

export default async function Page({ params }: PageProps<"/[lang]/docs/[[...slug]]">) {
  const { lang, slug } = await params;
  if (!isLocale(lang)) notFound();
  const page = source.getPage(slug, lang);
  if (!page) notFound();

  const MDX = page.data.body;
  const t = getDictionary(lang).docs;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      {page.data.since && <Since version={page.data.since} lang={lang} />}
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        {IS_PRERELEASE && (
          <Callout type="warn">
            {t.betaNotice.before}
            <code>{PACKAGE_VERSION}</code>
            {t.betaNotice.middle}
            <code>npm install better-payment@beta</code>
            {t.betaNotice.after}
            <a href={`${SITE_URL}${localePath(lang, `/docs${slug?.length ? `/${slug.join("/")}` : ""}`)}`}>
              {t.betaNotice.link}
            </a>
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
