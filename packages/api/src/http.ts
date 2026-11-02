export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export function wantsHtml(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/html");
}
