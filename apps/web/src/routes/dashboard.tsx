import { Navigate } from "react-router";

import { authClient } from "@/lib/auth-client";

export default function Dashboard() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return <div className="p-8 text-sm text-muted-foreground">Opening your library…</div>;
  }

  return <Navigate to={session ? "/" : "/login"} replace />;
}
