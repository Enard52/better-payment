/** Mega menu structure: destinations and icons. Copy lives in the dictionary (`nav.menu`). */
export const GITHUB_URL = "https://github.com/czaydev/better-payment";

export type MenuIcon = "layers" | "shield" | "wallet" | "puzzle" | "rocket" | "download" | "globe" | "book" | "card" | "clock" | "sparkles" | "route" | "alert" | "plug" | "github";

export const productLinks = [
  { id: "unified", href: "/docs/concepts/configuration", icon: "layers" },
  { id: "handler", href: "/docs/concepts/handler", icon: "shield" },
  { id: "payments", href: "/docs/payments/basket", icon: "wallet" },
  { id: "plugins", href: "/docs/concepts/plugins", icon: "puzzle" },
] as const satisfies readonly { id: string; href: string; icon: MenuIcon }[];

export const gatewayLinks = [
  { id: "iyzico", href: "/docs/providers/iyzico", name: "iyzico" },
  { id: "paytr", href: "/docs/providers/paytr", name: "PayTR" },
  { id: "sipay", href: "/docs/providers/sipay", name: "Sipay" },
  { id: "parampos", href: "/docs/providers/parampos", name: "Parampos" },
] as const;

export const bankLinks = [
  { id: "akbank", href: "/docs/banks/akbank", name: "Akbank" },
  { id: "est", href: "/docs/banks/est", name: "EST / NestPay" },
  { id: "kuveytturk", href: "/docs/banks/kuveytturk", name: "Kuveyt Türk" },
] as const;

export const developerLinks = [
  { id: "quickStart", href: "/docs/quick-start", icon: "rocket" },
  { id: "installation", href: "/docs/installation", icon: "download" },
  { id: "nextjs", href: "/docs/integrations/nextjs", icon: "route" },
  { id: "edge", href: "/docs/integrations/edge", icon: "globe" },
  { id: "api", href: "/docs/reference/api", icon: "book" },
  { id: "testCards", href: "/docs/guides/test-cards", icon: "card" },
] as const satisfies readonly { id: string; href: string; icon: MenuIcon }[];

export const resourceLinks = [
  { id: "changelog", href: "/docs/reference/changelog", icon: "clock" },
  { id: "whatsNew", href: "/docs/whats-new", icon: "sparkles" },
  { id: "migration", href: "/docs/guides/migration-0-5", icon: "route" },
  { id: "errorCodes", href: "/docs/reference/error-codes", icon: "alert" },
  { id: "customProviders", href: "/docs/guides/custom-providers", icon: "plug" },
  { id: "github", href: GITHUB_URL, icon: "github", external: true },
] as const satisfies readonly { id: string; href: string; icon: MenuIcon; external?: boolean }[];
