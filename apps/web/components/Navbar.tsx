"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { buttonVariants } from "@/lib/button-variants";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle, ArrowRight, BookOpen, ChevronDown, ChevronRight, Clock, CreditCard, Download, Globe, Layers,
  Menu, Plug, Puzzle, Rocket, Route, Shield, Sparkles, Wallet, X, type LucideIcon,
} from "lucide-react";
import { GitHubIcon } from "@/components/icons";
import ThemeToggle from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { LOCALE_NAMES, localePath, type Locale } from "@/lib/i18n/config";
import { switchLocale, switchLocalePath } from "@/lib/i18n/switch";
import { withBasePath } from "@/lib/base-path";
import {
  bankLinks, developerLinks, gatewayLinks, GITHUB_URL, productLinks, resourceLinks, type MenuIcon,
} from "@/lib/nav-menu";

// Homepage sections are reached by scrolling, without a #hash in the address bar
export const SCROLL_TARGET_KEY = "bp-scroll-to";

const icons: Record<MenuIcon, LucideIcon | typeof GitHubIcon> = {
  layers: Layers, shield: Shield, wallet: Wallet, puzzle: Puzzle, rocket: Rocket, download: Download, globe: Globe,
  book: BookOpen, card: CreditCard, clock: Clock, sparkles: Sparkles, route: Route, alert: AlertTriangle, plug: Plug,
  github: GitHubIcon,
};

type MenuKey = "product" | "providers" | "developers" | "resources";
const MENU_KEYS: MenuKey[] = ["product", "providers", "developers", "resources"];

/** Switches the language and stays on the same page */
function LanguageSwitch({ lang, label }: { lang: Locale; label: string }) {
  const pathname = usePathname();
  const other: Locale = lang === "tr" ? "en" : "tr";
  return (
    <Link
      href={switchLocalePath(other, pathname)}
      hrefLang={other}
      // Not prefetched: the other language is opened with a full load (see switchLocale)
      prefetch={false}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        switchLocale(other, pathname);
      }}
      aria-label={`${label}: ${LOCALE_NAMES[other]}`}
      className={cn(
        buttonVariants({ variant: "ghost", size: "sm" }),
        "text-muted-foreground hover:text-foreground h-8 px-2.5 text-xs font-medium font-mono uppercase",
      )}
    >
      {other}
    </Link>
  );
}

export default function Navbar({
  version,
  lang,
  t,
}: {
  version: string;
  lang: Locale;
  t: Dictionary["nav"];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<MenuKey | null>(null);
  const [mobileOpen, setMobileOpen] = useState<MenuKey | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const headerRef = useRef<HTMLElement>(null);

  const menu = t.menu;
  const href = (path: string) => (path.startsWith("http") ? path : localePath(lang, path));

  const show = useCallback((key: MenuKey) => {
    clearTimeout(closeTimer.current);
    setActive(key);
  }, []);
  const hideSoon = useCallback(() => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setActive(null), 120);
  }, []);
  const close = useCallback(() => {
    clearTimeout(closeTimer.current);
    setActive(null);
    setOpen(false);
  }, []);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 8);
    handler();
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    const onPointer = (event: PointerEvent) => {
      if (headerRef.current && !headerRef.current.contains(event.target as Node)) setActive(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [close]);

  const menuItem = (
    link: { id: string; href: string; icon: MenuIcon; external?: boolean },
    copy: { title: string; desc: string },
  ) => {
    const Icon = icons[link.icon];
    const external = "external" in link && link.external;
    return (
      <Link
        key={link.id}
        href={href(link.href)}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        onClick={close}
        className="group/item flex items-start gap-3 rounded-xl p-3 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      >
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-border bg-card text-primary transition-colors group-hover/item:border-line-strong group-hover/item:bg-tint">
          <Icon className="size-4.5" />
        </span>
        <span className="min-w-0">
          <span className="block text-[14.5px] font-semibold tracking-[-0.01em] text-foreground">{copy.title}</span>
          <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{copy.desc}</span>
        </span>
      </Link>
    );
  };

  const providerItem = (link: { id: string; href: string; name: string }) => {
    const desc = menu.providers.items[link.id as keyof typeof menu.providers.items];
    return (
      <Link
        key={link.id}
        href={href(link.href)}
        onClick={close}
        className="group/item block rounded-xl p-3 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      >
        <span className="flex items-center justify-between text-[14.5px] font-semibold tracking-[-0.01em] text-foreground">
          {link.name}
          <ArrowRight className="size-3.5 -translate-x-1 text-primary opacity-0 transition-all group-hover/item:translate-x-0 group-hover/item:opacity-100" />
        </span>
        <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{desc}</span>
      </Link>
    );
  };

  const panelTitle = (text: string) => (
    <p className="px-3 pb-1 font-mono text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">{text}</p>
  );

  function renderPanel(key: MenuKey) {
    switch (key) {
      case "product":
        return (
          <div className="grid grid-cols-[1.6fr_1fr] gap-6">
            <div className="grid grid-cols-2 gap-1">
              {productLinks.map((l) => menuItem(l, menu.product.items[l.id]))}
            </div>
            <Link
              href={href("/docs/integrations/edge")}
              onClick={close}
              className="group/feature relative flex flex-col justify-end overflow-hidden rounded-2xl border border-border bg-tint p-6 transition-colors hover:border-line-strong"
            >
              <div aria-hidden className="pointer-events-none absolute -top-16 -right-10 size-48 rounded-full bg-lilac/40 blur-3xl" />
              <Badge variant="secondary" className="relative mb-3 w-fit font-mono text-[10px]">
                {menu.product.feature.eyebrow}
              </Badge>
              <p className="relative text-lg font-bold tracking-[-0.02em] text-foreground">{menu.product.feature.title}</p>
              <p className="relative mt-1.5 text-[13.5px] leading-snug text-muted-foreground">{menu.product.feature.desc}</p>
              <span className="relative mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                {menu.product.feature.cta}
                <ArrowRight className="size-3.5 transition-transform group-hover/feature:translate-x-0.5" />
              </span>
            </Link>
          </div>
        );
      case "providers":
        return (
          <div className="grid grid-cols-[1fr_1fr_0.8fr] gap-6">
            <div>
              {panelTitle(menu.providers.gateways)}
              <div className="grid gap-1">{gatewayLinks.map(providerItem)}</div>
            </div>
            <div>
              {panelTitle(menu.providers.banks)}
              <div className="grid gap-1">{bankLinks.map(providerItem)}</div>
            </div>
            <Link
              href={href("/")}
              onClick={(event) => {
                close();
                if (pathname === localePath(lang, "/")) {
                  event.preventDefault();
                  document.getElementById("providers")?.scrollIntoView({ behavior: "smooth" });
                } else sessionStorage.setItem(SCROLL_TARGET_KEY, "providers");
              }}
              className="group/feature flex flex-col justify-end rounded-2xl border border-border bg-tint p-6 transition-colors hover:border-line-strong"
            >
              <p className="text-lg font-bold tracking-[-0.02em] text-foreground">{menu.providers.tagline}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                {menu.providers.all}
                <ArrowRight className="size-3.5 transition-transform group-hover/feature:translate-x-0.5" />
              </span>
            </Link>
          </div>
        );
      case "developers":
        return (
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            {developerLinks.map((l) => menuItem(l, menu.developers.items[l.id]))}
          </div>
        );
      case "resources":
        return (
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            {resourceLinks.map((l) => menuItem(l, menu.resources.items[l.id]))}
          </div>
        );
    }
  }

  return (
    <header
      ref={headerRef}
      onMouseLeave={hideSoon}
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-200",
        scrolled || active || open
          ? "bg-background/90 backdrop-blur-2xl border-b border-border"
          : "bg-background/60 backdrop-blur-xl border-b border-transparent",
      )}
    >
      <nav aria-label="Main" className="max-w-6xl mx-auto px-5 sm:px-8 flex items-center justify-between h-16">
        {/* Logo */}
        <Link href={localePath(lang, "/")} className="flex items-center gap-2.5 group">
          <Image
            src={withBasePath("/brand/better-payment-horizontal-color.svg")}
            width={1226}
            height={155}
            alt="Better Payment"
            priority
            className="h-6 w-auto dark:hidden"
          />
          <Image
            src={withBasePath("/brand/better-payment-horizontal-dark.svg")}
            width={1226}
            height={155}
            alt="Better Payment"
            priority
            className="hidden h-6 w-auto dark:block"
          />
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 hidden xl:flex font-mono tracking-tight">
            v{version}
          </Badge>
        </Link>

        {/* Desktop nav */}
        <div className="hidden lg:flex items-center gap-0.5">
          {MENU_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              aria-expanded={active === key}
              aria-controls="mega-panel"
              onMouseEnter={() => show(key)}
              onFocus={() => show(key)}
              onClick={() => (active === key ? setActive(null) : show(key))}
              className={cn(
                "inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:outline-2 focus-visible:outline-primary",
                active === key ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {menu[key].label}
              <ChevronDown className={cn("size-3.5 transition-transform duration-200", active === key && "rotate-180")} />
            </button>
          ))}
          <Link
            href={localePath(lang, "/docs")}
            onMouseEnter={hideSoon}
            className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {t.docs}
          </Link>
        </div>

        {/* Desktop actions */}
        <div className="hidden lg:flex items-center gap-1.5">
          <ThemeToggle label={t.theme} />
          <LanguageSwitch lang={lang} label={t.language} />
          <Separator orientation="vertical" className="mx-1 h-4 data-vertical:self-center" />
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <GitHubIcon data-icon="brand" />
            GitHub
          </a>
          <Link href={localePath(lang, "/docs")} className={buttonVariants({ size: "sm" })}>
            {t.getStarted}
            <ChevronRight data-icon="chevron" />
          </Link>
        </div>

        {/* Mobile menu toggle */}
        <button
          aria-label={t.openMenu}
          aria-expanded={open}
          className="lg:hidden p-2 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-accent/60"
          onClick={() => setOpen(!open)}
        >
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </nav>

      {/* Desktop mega panel */}
      <div
        id="mega-panel"
        onMouseEnter={() => active && show(active)}
        className={cn(
          "hidden lg:block absolute inset-x-0 top-full border-b border-border bg-background/95 backdrop-blur-2xl shadow-[0_24px_48px_-24px_var(--bp-shadow)] transition-[opacity,translate,visibility] duration-(--bp-d-sm) ease-brand",
          active ? "visible translate-y-0 opacity-100" : "invisible -translate-y-1 opacity-0 pointer-events-none",
        )}
      >
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-6">{active && renderPanel(active)}</div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="lg:hidden max-h-[calc(100svh-4rem)] overflow-y-auto border-t border-border bg-background px-5 py-3 flex flex-col gap-0.5">
          {MENU_KEYS.map((key) => {
            const expanded = mobileOpen === key;
            const entries: { id: string; href: string; title: string; desc?: string }[] =
              key === "product"
                ? productLinks.map((l) => ({ ...l, ...menu.product.items[l.id] }))
                : key === "providers"
                  ? [...gatewayLinks, ...bankLinks].map((l) => ({
                      id: l.id,
                      href: l.href,
                      title: l.name,
                      desc: menu.providers.items[l.id],
                    }))
                  : key === "developers"
                    ? developerLinks.map((l) => ({ ...l, ...menu.developers.items[l.id] }))
                    : resourceLinks.map((l) => ({ ...l, ...menu.resources.items[l.id] }));
            return (
              <div key={key} className="border-b border-border/70 last:border-0">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setMobileOpen(expanded ? null : key)}
                  className="flex w-full items-center justify-between px-1 py-3 text-[15px] font-semibold text-foreground"
                >
                  {menu[key].label}
                  <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", expanded && "rotate-180")} />
                </button>
                {expanded && (
                  <div className="grid gap-0.5 pb-3">
                    {entries.map((e) => (
                      <Link
                        key={e.id}
                        href={href(e.href)}
                        onClick={close}
                        className="rounded-lg px-3 py-2 hover:bg-accent"
                      >
                        <span className="block text-sm font-medium text-foreground">{e.title}</span>
                        {e.desc && <span className="block text-[13px] text-muted-foreground">{e.desc}</span>}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <Link
            href={localePath(lang, "/docs")}
            onClick={close}
            className="px-1 py-3 text-[15px] font-semibold text-foreground"
          >
            {t.docs}
          </Link>
          <Separator className="my-1.5" />
          <div className="flex gap-2 pt-2 pb-1">
            <ThemeToggle label={t.theme} className="h-9 shrink-0" />
            <LanguageSwitch lang={lang} label={t.language} />
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "flex-1")}
            >
              <GitHubIcon data-icon="brand" />
              GitHub
            </a>
            <Link href={localePath(lang, "/docs")} className={cn(buttonVariants({ size: "sm" }), "flex-1")} onClick={close}>
              {t.getStarted}
              <ChevronRight data-icon="chevron" />
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
