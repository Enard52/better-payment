// Who to thank for a changeset. Used by .changeset/changelog.cjs (CHANGELOG.md) and
// scripts/version-packages.mjs (docs changelog), so a contributor's pull request is credited
// without anyone writing "Thanks to ..." by hand.
//
// The changeset's author is the author of the pull request that added the file. It is read from
// git history (following renames, because beta releases move changesets to .changeset/pre/), then
// resolved to a GitHub login. With GITHUB_TOKEN set (always the case in Actions) the pull
// request number comes along; without it the login is read from a noreply commit email, and a
// release is never blocked: no credit is better than a failed release.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const repository = process.env.GITHUB_REPOSITORY || 'czaydev/better-payment';

// The owner is not thanked in their own changelog; bots and AI assistants never are
const NOT_CREDITED = new Set(['czaydev', 'claude']);

const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

async function github(path) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) return null;
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/** The commit that first added a changeset file, found through renames. `id` is its file name. */
function addingCommit(id) {
  for (const path of [`.changeset/${id}.md`, `.changeset/pre/${id}.md`]) {
    const shas = git('log', '--follow', '--diff-filter=A', '--format=%H', '--', path).split('\n').filter(Boolean);
    if (shas.length) return shas[shas.length - 1];
  }
  return '';
}

/**
 * `{ login, pull }` for the contributor of a changeset, or null when there is nobody to thank.
 * `pull` is the pull request number, when GitHub could tell.
 */
export async function creditFor(id) {
  const sha = addingCommit(id);
  if (!sha) return null;

  let login = '';
  let pull;
  const pulls = await github(`/commits/${sha}/pulls`);
  if (Array.isArray(pulls) && pulls[0]) {
    login = pulls[0].user?.login ?? '';
    pull = pulls[0].number;
  }
  if (!login) {
    const commit = await github(`/commits/${sha}`);
    login = commit?.author?.login ?? '';
  }
  if (!login) {
    // 12345+login@users.noreply.github.com, the address GitHub gives contributors who hide theirs
    const email = git('log', '-1', '--format=%ae', sha);
    login = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/.exec(email)?.[1] ?? '';
  }

  if (!login || login.endsWith('[bot]') || NOT_CREDITED.has(login.toLowerCase())) return null;
  return { login, pull };
}
