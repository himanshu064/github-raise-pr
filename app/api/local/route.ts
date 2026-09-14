import { NextResponse } from "next/server";
import { inspect } from "@/lib/local";

/** Read a local checkout: its SSH remote, current branch, and push state. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const dir = params.get("dir")?.trim();
  if (!dir) return NextResponse.json({ error: "dir is required" }, { status: 400 });

  try {
    return NextResponse.json(await inspect(dir, params.get("remote") ?? undefined));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not read that directory" },
      { status: 400 },
    );
  }
}
