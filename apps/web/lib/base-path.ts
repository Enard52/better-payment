/**
 * The beta docs are a second deployment of this site, built from the `beta` branch with
 * `NEXT_PUBLIC_BASE_PATH=/beta`, and served under /beta on the main domain (see next.config.ts).
 * next/link adds the base path itself; files from public/ and full page loads need `withBasePath`.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** "/brand/logo.svg" → "/beta/brand/logo.svg" on the beta deployment */
export function withBasePath(path: string): string {
  return `${BASE_PATH}${path}`;
}
