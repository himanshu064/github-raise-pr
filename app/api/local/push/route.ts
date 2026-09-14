import { NextResponse } from "next/server";
import { inspect, push } from "@/lib/local";

/**
 * Push the branch using the repo's own remote — SSH keys, agent and all.
 * This is the one step of the flow SSH genuinely performs; the PR itself
 * still goes over HTTPS to the REST API.
 */
export async function POST(req: Request) {
  const { dir, remote, branch } = (await req.json()) as {
    dir?: string;
    remote?: string;
    branch?: string;
  };
  if (!dir || !remote || !branch) {
    return NextResponse.json({ error: "dir, remote and branch are required" }, { status: 400 });
  }

  try {
    const result = await push(dir, remote, branch);
    // Re-read so the UI's ahead/behind and upstream state reflect the push.
    const state = await inspect(dir, remote);
    return NextResponse.json({ ...result, state });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "git push failed" },
      { status: 400 },
    );
  }
}
