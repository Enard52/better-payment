import packageJson from "../../../packages/better-payment/package.json";

/**
 * Where a feature added in a version stands for this build of the site:
 * - `stable`: released on the npm `latest` tag
 * - `beta`: in the current prerelease (the beta site builds `0.12.0-beta.N`, so `0.12.0` is in beta)
 * - `unreleased`: not published yet
 *
 * After a beta is promoted, the package version becomes `0.12.0` and every `0.12.0` feature turns
 * stable on its own, so nothing has to be edited by hand.
 */
export type ReleaseStatus = "stable" | "beta" | "unreleased";

/** The version of better-payment this site is built from */
export const PACKAGE_VERSION = packageJson.version;

/** True when the site is built from a prerelease (the beta site) */
export const IS_PRERELEASE = PACKAGE_VERSION.includes("-");

interface ParsedVersion {
  core: [number, number, number];
  prerelease: boolean;
}

function parseVersion(version: string): ParsedVersion {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) throw new Error(`Invalid release version: ${version}`);

  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] !== undefined,
  };
}

export function releaseStatus(version: string, currentVersion = PACKAGE_VERSION): ReleaseStatus {
  const target = parseVersion(version);
  const current = parseVersion(currentVersion);

  for (let i = 0; i < 3; i++) {
    if (target.core[i] < current.core[i]) return "stable";
    if (target.core[i] > current.core[i]) return "unreleased";
  }

  return current.prerelease ? "beta" : "stable";
}
