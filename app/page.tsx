"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type RepoSummary = { full_name: string; default_branch: string; private: boolean };
type Preview = { commits: number; files: number; behind_by: number; existing: { number: number; html_url: string } | null };
type Created = { number: number; html_url: string; title: string; reviewerError: string | null };

const TOKEN_KEY = "gh-pr-token";

export default function Home() {
  const [token, setToken] = useState("");
  const [serverAuthed, setServerAuthed] = useState(false); // true when server already has a token
  const [login, setLogin] = useState<string | null>(null);
  const [repos, setRepos] = useState<RepoSummary[]>([]);

  const [repo, setRepo] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [base, setBase] = useState("");
  const [head, setHead] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [reviewers, setReviewers] = useState("");
  const [draft, setDraft] = useState(false);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  console.log("App Loaded!");

  // The token only ever leaves the browser as a header to our own API route,
  // which forwards it to GitHub. It is never put in a URL or logged.
  const authFetch = useCallback(
    (url: string, init: RequestInit = {}) =>
      fetch(url, {
        ...init,
        headers: { ...(init.headers ?? {}), ...(token ? { "x-github-token": token } : {}) },
      }),
    [token],
  );

  const loadRepos = useCallback(async () => {
    const res = await authFetch("/api/github/repos");
    const data = await res.json();
    if (!res.ok) {
      setLogin(null);
      setServerAuthed(false);
      setRepos([]);
      if (res.status !== 401 || token) setError(data.error);
      return;
    }
    setError(null);
    setLogin(data.login);
    setServerAuthed(Boolean(data.serverAuthed));
    setRepos(data.repos);
    // Reset downstream selections when token/repos reload
    setRepo("");
    setBranches([]);
    setBase("");
    setHead("");
  }, [authFetch, token]);

  // On load: silently probe the server for a configured env token.
  // If GITHUB_TOKEN is set in .env the server authenticates without any
  // user input — skip the PAT panel and load repos straight away.
  // If not, fall back to any PAT saved in sessionStorage.
  useEffect(() => {
    fetch("/api/github/repos")
      .then(async (res) => {
        if (!res.ok) {
          // No server token — restore PAT from sessionStorage instead.
          const saved = sessionStorage.getItem(TOKEN_KEY);
          if (saved) setToken(saved);
          return;
        }
        const data = await res.json();
        setLogin(data.login);
        setServerAuthed(Boolean(data.serverAuthed));
        setRepos(data.repos);
      })
      .catch(() => {
        const saved = sessionStorage.getItem(TOKEN_KEY);
        if (saved) setToken(saved);
      });
  }, []);

  // Repo picked: pull its branches and default the base to the default branch.
  useEffect(() => {
    if (!repo) {
      setBranches([]);
      setBase("");
      setHead("");
      return;
    }
    let cancelled = false;
    authFetch(`/api/github/branches?repo=${encodeURIComponent(repo)}`)
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error);
          setBranches([]);
          return;
        }
        setError(null);
        setBranches(data.branches);
        setBase(data.default_branch ?? "");
        setHead("");
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [repo, authFetch]);

  // Compare base...head so you see what the PR would contain before opening it.
  useEffect(() => {
    if (!repo || !base || !head || base === head) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ repo, base, head });
    authFetch(`/api/github/pr?${params}`)
      .then(async (res) => {
        const data = await res.json();
        if (!cancelled) setPreview(res.ok ? data : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [repo, base, head, authFetch]);

  const canSubmit = useMemo(
    () => Boolean(repo && base && head && base !== head && title.trim()) && !busy,
    [repo, base, head, title, busy],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const res = await authFetch("/api/github/pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, base, head, title, body, draft, reviewers }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error);
      else setCreated(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  function saveToken(value: string) {
    setToken(value);
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  }

  function clearAuth() {
    saveToken("");
    setLogin(null);
    setServerAuthed(false);
    setRepos([]);
    setRepo("");
    setBranches([]);
    setBase("");
    setHead("");
    setPreview(null);
    setCreated(null);
    setError(null);
  }

  return (
    <main>
      <h1>Raise a pull request</h1>
      <p className="sub">Opens a PR through the GitHub REST API — paste your token, load repos, and go.</p>

      {/* ── Token ── */}
      {serverAuthed ? (
        // Server already has a token configured (.env or gh CLI) — no user input needed.
        <div className="notice">
          ✅ Authenticated as <strong>{login}</strong>.
        </div>
      ) : (
        // No server token — ask the user to paste a PAT.
        <div className="panel">
          <div className="field">
            <label htmlFor="token">Personal access token</label>
            <div className="row">
              <input
                id="token"
                type="password"
                placeholder="github_pat_… or ghp_…"
                value={token}
                onChange={(e) => saveToken(e.target.value.trim())}
                autoComplete="off"
                style={{ flex: "1" }}
              />
              <button
                type="button"
                className="secondary"
                style={{ flex: "0 0 auto" }}
                disabled={!token.trim() || busy}
                onClick={() => void loadRepos()}
              >
                Load Repos
              </button>
            </div>
            {login ? (
              <p className="hint" style={{ color: "green" }}>
                ✅ Authenticated as <strong>{login}</strong>.{" "}
                <button type="button" className="linkish" onClick={clearAuth}>
                  clear
                </button>
              </p>
            ) : (
              <p className="hint">
                Fine-grained PAT needs: <code>Contents: Read</code> + <code>Pull requests: Read &amp; Write</code>. Kept in sessionStorage only.
              </p>
            )}
          </div>
        </div>
      )}

      {error && <div className="notice err">{error}</div>}

      {created && (
        <div className="notice ok">
          PR #{created.number} created —{" "}
          <a href={created.html_url} target="_blank" rel="noreferrer">
            {created.html_url}
          </a>
          {created.reviewerError && <div>Reviewers not added: {created.reviewerError}</div>}
        </div>
      )}

      {/* ── PR form ── */}
      <form className="panel" onSubmit={submit}>
        <div className="field">
          <label htmlFor="repo">Repository</label>
          <select id="repo" value={repo} onChange={(e) => setRepo(e.target.value)} disabled={!repos.length}>
            <option value="">Select a repository…</option>
            {repos.map((r) => (
              <option key={r.full_name} value={r.full_name}>
                {r.full_name} {r.private ? "🔒" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="field row">
          <div>
            <label htmlFor="head">Compare (head)</label>
            <select id="head" value={head} onChange={(e) => setHead(e.target.value)} disabled={!branches.length}>
              <option value="">Select a branch…</option>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="base">Into (base)</label>
            <select id="base" value={base} onChange={(e) => setBase(e.target.value)} disabled={!branches.length}>
              <option value="">Select a branch…</option>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
        </div>

        {preview && (
          <p className="preview">
            {preview.existing ? (
              <>
                A PR is already open for this pair:{" "}
                <a href={preview.existing.html_url} target="_blank" rel="noreferrer">
                  #{preview.existing.number}
                </a>
              </>
            ) : preview.commits === 0 ? (
              "No commits between these branches — the PR will be rejected by GitHub."
            ) : (
              `${preview.commits} commit${preview.commits === 1 ? "" : "s"}, ${preview.files} file${preview.files === 1 ? "" : "s"} changed${preview.behind_by ? ` · ${preview.behind_by} behind ${base}` : ""}`
            )}
          </p>
        )}

        <div className="field" style={{ marginTop: 16 }}>
          <label htmlFor="title">Title</label>
          <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short summary of the change" />
        </div>

        <div className="field">
          <label htmlFor="body">Description</label>
          <textarea id="body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Markdown supported" />
        </div>

        <div className="field">
          <label htmlFor="reviewers">Reviewers</label>
          <input
            id="reviewers"
            value={reviewers}
            onChange={(e) => setReviewers(e.target.value)}
            placeholder="comma-separated usernames (optional)"
          />
        </div>

        <div className="field check">
          <input id="draft" type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
          <label htmlFor="draft" style={{ marginBottom: 0 }}>
            Open as draft
          </label>
        </div>

        <button type="submit" disabled={!canSubmit}>
          {busy ? "Creating…" : "Create pull request"}
        </button>
      </form>
    </main>
  );
}
