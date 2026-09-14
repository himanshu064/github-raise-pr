import { NextResponse } from "next/server";
import { errorResponse, gh, resolveToken } from "@/lib/github";

type Repo = { full_name: string; default_branch: string; private: boolean; permissions?: { push?: boolean } };

export async function GET(req: Request) {
  const auth = await resolveToken(req);
  if (!auth) return NextResponse.json({ error: "No GitHub token provided" }, { status: 401 });
  const { token, source } = auth;

  try {
    const user = await gh<{ login: string }>("/user", token);
    const repos = await gh<Repo[]>(
      "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
      token,
    );
    return NextResponse.json({
      login: user.login,
      // Only tell the UI *that* it's server-authed, not *how* (never leak source details).
      serverAuthed: source === "env" || source === "gh-cli",
      repos: repos.map((r) => ({
        full_name: r.full_name,
        default_branch: r.default_branch,
        private: r.private,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

