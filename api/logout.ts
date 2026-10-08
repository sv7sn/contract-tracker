import { sessionCookie } from "./_crypto.js";

export function POST(request: Request) {
  return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(request, null) } });
}
