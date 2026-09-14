# Raise a PR

A small Next.js app that opens GitHub pull requests through the REST API.

SSH is only a transport for `git` itself — it can't create a PR. So this app does
what any PR CLI does: it talks to `https://api.github.com` over HTTPS with a token.
The token lives on the server (or in `sessionStorage`), never in a URL or a log.

## Run it

```bash
npm install
cp .env.example .env.local   # optional — paste a token to skip the UI field
npm run dev                  # http://localhost:3000
```

## Token

A fine-grained PAT with, on the repos you care about:

- **Pull requests:** Read and write
- **Contents:** Read-only

A classic PAT works too, with the `repo` scope.

If `GITHUB_TOKEN` is set in `.env.local`, the app uses it and hides the token
field. Otherwise you paste one into the UI and it is kept in `sessionStorage`
for that tab only.

## What it does

1. Lists the repos your token can reach, and the branches of the one you pick.
2. Compares `base...head` first, so you see the commit and file counts — and any
   PR that's already open for that pair — before you submit.
3. `POST /repos/{owner}/{repo}/pulls` to create the PR, then optionally
   `POST .../requested_reviewers`. A reviewer failure never loses the PR.

The repo field accepts `owner/repo`, `git@github.com:owner/repo.git`, or an
https URL — paste whatever `git remote get-url origin` gives you.

## Layout

```
app/
  page.tsx                      the form
  api/github/repos/route.ts     GET  your repos
  api/github/branches/route.ts  GET  branches for one repo
  api/github/pr/route.ts        GET  compare preview · POST create
lib/github.ts                   fetch wrapper, token resolution, URL parsing
```

## Common 422s

GitHub returns 422 rather than a useful status for most mistakes; the app
surfaces the `errors[].message` detail:

- **No commits between base and head** — the branch isn't pushed, or has no new commits.
- **A pull request already exists** — the preview line links to it.
- **Field head is invalid** — the branch name is wrong, or it's on a fork (use `owner:branch`).
