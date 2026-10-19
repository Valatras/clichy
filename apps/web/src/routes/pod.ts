import { hostname } from "node:os";

export function loader() {
  return Response.json(
    { podName: hostname() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
