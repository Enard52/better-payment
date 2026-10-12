import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { source } from "@/lib/source";
import { isLocale, localePath } from "@/lib/i18n/config";
import { notFound } from "next/navigation";
import Image from "next/image";
import { withBasePath } from "@/lib/base-path";
import { VersionPicker } from "@/components/docs/VersionPicker";
import { IS_PRERELEASE } from "@/lib/release";

// The picker shows on the beta deployment, and on the stable one while it serves a beta (BETA_ORIGIN)
const SHOW_VERSION_PICKER = IS_PRERELEASE || process.env.NEXT_PUBLIC_BETA_DOCS === "1";

export default async function Layout({ children, params }: LayoutProps<"/[lang]/docs">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  return (
    <DocsLayout
      tree={source.getPageTree(lang)}
      i18n
      nav={{
        title: (
          <>
            <Image
              src={withBasePath("/brand/better-payment-horizontal-color.svg")}
              width={1226}
              height={155}
              alt="Better Payment"
              className="h-5 w-auto dark:hidden"
            />
            <Image
              src={withBasePath("/brand/better-payment-horizontal-dark.svg")}
              width={1226}
              height={155}
              alt="Better Payment"
              className="hidden h-5 w-auto dark:block"
            />
          </>
        ),
        url: localePath(lang, "/"),
      }}
      githubUrl="https://github.com/czaydev/better-payment"
      sidebar={SHOW_VERSION_PICKER ? { banner: <VersionPicker lang={lang} beta={IS_PRERELEASE} /> } : undefined}
    >
      {children}
    </DocsLayout>
  );
}
