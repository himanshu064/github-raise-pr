import { NextResponse } from "next/server";
import { errorResponse, gh, parseRepo, resolveToken } from "@/lib/github";

/**
 * Preview: how many commits/files separate head from base, and whether a PR
 * for this pair is already open. Saves a round trip to a 422 from GitHub.
 */
export async function GET(req: Request) {
  const auth = await resolveToken(req);
  if (!auth) return NextResponse.json({ error: "No GitHub token provided" }, { status: 401 });
  const { token } = auth;

  const params = new URL(req.url).searchParams;
  const target = parseRepo(params.get("repo") ?? "");
  const base = params.get("base");
  const head = params.get("head");
  if (!target || !base || !head) {
    return NextResponse.json({ error: "repo, base and head are required" }, { status: 400 });
  }

  const { owner, repo } = target;
  try {
    const [compare, open] = await Promise.all([
      gh<{ ahead_by: number; behind_by: number; files?: unknown[]; commits: unknown[] }>(
        `/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
        token,
      ),
      gh<{ number: number; html_url: string }[]>(
        `/repos/${owner}/${repo}/pulls?state=open&base=${encodeURIComponent(base)}&head=${encodeURIComponent(`${owner}:${head}`)}`,
        token,
      ),
    ]);

    return NextResponse.json({
      commits: compare.commits.length,
      files: compare.files?.length ?? 0,
      behind_by: compare.behind_by,
      existing: open[0] ? { number: open[0].number, html_url: open[0].html_url } : null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

const MAX_TITLE = 256;
const MAX_BODY = 65_536; // 64 KB — GitHub's own limit
const MAX_REVIEWERS = 10;
const SAFE_BRANCH = /^[^\x00-\x1f\x7f\\^~:?*[\]@ ]+$/; // no shell-special chars

export async function POST(req: Request) {
  const auth = await resolveToken(req);
  if (!auth) return NextResponse.json({ error: "No GitHub token provided" }, { status: 401 });
  const { token } = auth;

  const body = (await req.json()) as {
    repo?: string;
    base?: string;
    head?: string;
    title?: string;
    body?: string;
    draft?: boolean;
    reviewers?: string;
  };

  const target = parseRepo(body.repo ?? "");
  if (!target) return NextResponse.json({ error: "Expected owner/repo" }, { status: 400 });
  if (!body.base || !body.head) return NextResponse.json({ error: "base and head are required" }, { status: 400 });
  if (!body.title?.trim()) return NextResponse.json({ error: "title is required" }, { status: 400 });
  if (body.base === body.head) return NextResponse.json({ error: "base and head must differ" }, { status: 400 });

  // Input length guards
  if (body.title.trim().length > MAX_TITLE)
    return NextResponse.json({ error: `title must be ${MAX_TITLE} characters or fewer` }, { status: 400 });
  if ((body.body ?? "").length > MAX_BODY)
    return NextResponse.json({ error: "description is too long" }, { status: 400 });
  if (!SAFE_BRANCH.test(body.base) || !SAFE_BRANCH.test(body.head))
    return NextResponse.json({ error: "branch name contains invalid characters" }, { status: 400 });

  const reviewerList = (body.reviewers ?? "").split(",").map((r) => r.trim()).filter(Boolean);
  if (reviewerList.length > MAX_REVIEWERS)
    return NextResponse.json({ error: `too many reviewers (max ${MAX_REVIEWERS})` }, { status: 400 });

  const { owner, repo } = target;
  try {
    const pr = await gh<{ number: number; html_url: string; title: string }>(
      `/repos/${owner}/${repo}/pulls`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          title: body.title.trim(),
          head: body.head,
          base: body.base,
          body: body.body ?? "",
          draft: Boolean(body.draft),
        }),
      },
    );

    // Reviewers are a separate endpoint; a failure here shouldn't lose the PR.
    let reviewerError: string | null = null;
    if (reviewerList.length) {
      try {
        await gh(`/repos/${owner}/${repo}/pulls/${pr.number}/requested_reviewers`, token, {
          method: "POST",
          body: JSON.stringify({ reviewers: reviewerList }),
        });
      } catch (err) {
        reviewerError = (err as { message?: string }).message ?? "Could not request reviewers";
      }
    }

    return NextResponse.json({ number: pr.number, html_url: pr.html_url, title: pr.title, reviewerError });
  } catch (err) {
    return errorResponse(err);
  }
}
