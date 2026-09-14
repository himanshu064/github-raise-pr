import { NextResponse } from "next/server";
import { errorResponse, gh, parseRepo, resolveToken } from "@/lib/github";

export async function GET(req: Request) {
  const auth = await resolveToken(req);
  if (!auth) return NextResponse.json({ error: "No GitHub token provided" }, { status: 401 });
  const { token } = auth;

  const target = parseRepo(new URL(req.url).searchParams.get("repo") ?? "");
  if (!target) return NextResponse.json({ error: "Expected owner/repo" }, { status: 400 });

  const { owner, repo } = target;
  try {
    const [info, branches] = await Promise.all([
      gh<{ default_branch: string }>(`/repos/${owner}/${repo}`, token),
      gh<{ name: string }[]>(`/repos/${owner}/${repo}/branches?per_page=100`, token),
    ]);
    return NextResponse.json({
      default_branch: info.default_branch,
      branches: branches.map((b) => b.name),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
