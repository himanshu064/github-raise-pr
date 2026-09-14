import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Every git call goes through execFile with an argv array — never a shell
 * string — so a path or branch name can't inject a command. The one remaining
 * trick is an argument that starts with `-` being read as a flag, so reject those.
 */
function assertSafe(value: string, what: string) {
  if (!value || value.startsWith("-")) throw new Error(`Invalid ${what}`);
}

async function git(dir: string, args: string[], timeout = 15_000) {
  const { stdout } = await run("git", ["-C", dir, ...args], {
    timeout,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      ...process.env,
      // Fail fast instead of hanging on a credential or host-key prompt that
      // nobody can answer — there's no TTY behind a web request.
      GIT_TERMINAL_PROMPT: "0",
      GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes",
    },
  });
  return stdout.trim();
}

/** Same call, but "this just isn't set" is an expected answer, not a failure. */
async function tryGit(dir: string, args: string[]) {
  try {
    return await git(dir, args);
  } catch {
    return null;
  }
}

export type RemoteInfo = {
  name: string;
  url: string;
  protocol: "ssh" | "https" | "other";
  owner: string | null;
  repo: string | null;
};

export type LocalRepo = {
  root: string;
  branch: string | null;
  remotes: RemoteInfo[];
  remote: RemoteInfo | null;
  defaultBranch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  dirty: boolean;
  /** True when head has commits the remote hasn't got — pushing is required first. */
  needsPush: boolean;
};

function classify(url: string): RemoteInfo["protocol"] {
  if (url.startsWith("git@") || url.startsWith("ssh://")) return "ssh";
  if (url.startsWith("http://") || url.startsWith("https://")) return "https";
  return "other";
}

function ownerRepo(url: string): { owner: string | null; repo: string | null } {
  const s = url.trim().replace(/\/+$/, "");
  const patterns = [
    /^git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/,
    /^ssh:\/\/git@[^/]+\/([^/]+)\/(.+?)(?:\.git)?$/,
    /^https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?$/,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) return { owner: m[1], repo: m[2] };
  }
  return { owner: null, repo: null };
}

export async function inspect(dir: string, preferredRemote?: string): Promise<LocalRepo> {
  assertSafe(dir, "path");

  const inside = await tryGit(dir, ["rev-parse", "--is-inside-work-tree"]);
  if (inside !== "true") throw new Error(`Not a git repository: ${dir}`);

  const root = await git(dir, ["rev-parse", "--show-toplevel"]);
  const branch = (await tryGit(dir, ["branch", "--show-current"])) || null;

  const names = (await git(dir, ["remote"])).split("\n").filter(Boolean);
  const remotes: RemoteInfo[] = await Promise.all(
    names.map(async (name) => {
      const url = (await tryGit(dir, ["remote", "get-url", name])) ?? "";
      return { name, url, protocol: classify(url), ...ownerRepo(url) };
    }),
  );

  const remote =
    remotes.find((r) => r.name === preferredRemote) ??
    remotes.find((r) => r.name === "origin") ??
    remotes[0] ??
    null;

  // origin/HEAD is only set if the clone recorded it; absent is normal.
  const headRef = remote ? await tryGit(dir, ["symbolic-ref", "--short", `refs/remotes/${remote.name}/HEAD`]) : null;
  const defaultBranch = headRef ? headRef.replace(`${remote!.name}/`, "") : null;

  const upstream = await tryGit(dir, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);

  let ahead = 0;
  let behind = 0;
  if (upstream) {
    const counts = await tryGit(dir, ["rev-list", "--left-right", "--count", "@{u}...HEAD"]);
    const [b, a] = (counts ?? "0\t0").split(/\s+/).map(Number);
    behind = b || 0;
    ahead = a || 0;
  }

  const dirty = Boolean(await tryGit(dir, ["status", "--porcelain"]));

  return {
    root,
    branch,
    remotes,
    remote,
    defaultBranch,
    upstream,
    ahead,
    behind,
    dirty,
    needsPush: !upstream || ahead > 0,
  };
}

/**
 * Push the branch over whatever transport the remote uses — SSH keys and agent
 * included, since this is the user's own git running as the user.
 */
export async function push(dir: string, remote: string, branch: string) {
  assertSafe(dir, "path");
  assertSafe(remote, "remote name");
  assertSafe(branch, "branch name");

  try {
    // 60s: an SSH handshake plus a first push of a large branch is slow.
    const output = await git(dir, ["push", "--set-upstream", remote, `${branch}:${branch}`], 60_000);
    return { ok: true as const, output };
  } catch (err) {
    const e = err as { stderr?: string; message?: string; killed?: boolean };
    if (e.killed) {
      throw new Error("git push timed out — an SSH key with a passphrase needs ssh-agent loaded first.");
    }
    const stderr = (e.stderr ?? e.message ?? "").trim();
    if (/Permission denied \(publickey\)/i.test(stderr)) {
      throw new Error("SSH rejected the key. Check `ssh -T git@github.com` and that your key is in ssh-agent.");
    }
    if (/Host key verification failed/i.test(stderr)) {
      throw new Error("Host key not trusted. Run `ssh -T git@github.com` once to accept it.");
    }
    throw new Error(stderr || "git push failed");
  }
}

/** A token from the gh CLI, if the user is already logged in there. */
export async function ghCliToken(): Promise<string | null> {
  try {
    const { stdout } = await run("gh", ["auth", "token"], { timeout: 5_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
