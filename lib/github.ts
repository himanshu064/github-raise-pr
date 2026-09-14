import { NextResponse } from "next/server";
import { ghCliToken } from "./local";

const API = "https://api.github.com";

export type TokenSource = "header" | "env" | "gh-cli";

let ghCliCache: { token: string | null; at: number } | null = null;

/**
 * Token resolution order: the header the browser sends, then the server env,
 * then whatever the `gh` CLI is logged in with. The gh fallback is the reason
 * an SSH-only user never has to create a PAT — gh already holds one.
 */
export async function resolveToken(
  req: Request,
): Promise<{ token: string; source: TokenSource } | null> {
  const header = req.headers.get("x-github-token")?.trim();
  if (header) return { token: header, source: "header" };

  const env = process.env.GITHUB_TOKEN?.trim();
  if (env) return { token: env, source: "env" };

  // Shelling out to gh on every request would add ~100ms each time.
  if (!ghCliCache || Date.now() - ghCliCache.at > 60_000) {
    ghCliCache = { token: await ghCliToken(), at: Date.now() };
  }
  if (ghCliCache.token) return { token: ghCliCache.token, source: "gh-cli" };

  return null;
}

export type GitHubError = { status: number; message: string };

export async function gh<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    // GitHub puts the useful detail in `errors[].message` for 422s (the most
    // common failure here: no commits between base and head, or a PR already open).
    const detail = Array.isArray(data?.errors)
      ? data.errors.map((e: { message?: string; field?: string }) => e.message ?? e.field).filter(Boolean).join("; ")
      : "";
    const message = [data?.message, detail].filter(Boolean).join(" — ") || res.statusText;
    throw { status: res.status, message } satisfies GitHubError;
  }

  return data as T;
}

export function errorResponse(err: unknown) {
  const e = err as GitHubError;
  if (typeof e?.status === "number") {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json(
    { error: err instanceof Error ? err.message : "Unexpected error" },
    { status: 500 },
  );
}

/** Parse `owner/repo`, an SSH remote, or an https URL into its two parts. */
export function parseRepo(input: string): { owner: string; repo: string } | null {
  const s = input.trim().replace(/\/+$/, "");
  const patterns = [
    /^git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/,        // git@github.com:owner/repo.git
    /^ssh:\/\/git@[^/]+\/([^/]+)\/(.+?)(?:\.git)?$/, // ssh://git@github.com/owner/repo.git
    /^https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?$/, // https://github.com/owner/repo
    /^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/,           // owner/repo
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) return { owner: m[1], repo: m[2] };
  }
  return null;
}
