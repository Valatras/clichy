import { Button } from "@clichy/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@clichy/ui/components/dropdown-menu";
import { Skeleton } from "@clichy/ui/components/skeleton";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

export default function UserMenu() {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return <Skeleton className="h-9 w-24" />;
  }

  if (!session) {
    return (
      <Button
        variant="outline"
        nativeButton={false}
        render={<Link to="/login?mode=signin" />}
      >
        Sign in
      </Button>
    );
  }

  const userName = session.user.name || session.user.email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="max-w-40 gap-2 rounded-full px-2"
            aria-label="Open account menu"
          />
        }
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
          {userName.slice(0, 1).toLocaleUpperCase()}
        </span>
        <span className="hidden max-w-28 truncate text-sm sm:block">
          {userName}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="block font-medium text-foreground">{userName}</span>
            <span className="mt-1 block truncate">{session.user.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              authClient.signOut({
                fetchOptions: {
                  onSuccess: () => {
                    toast.success("You have signed out");
                    navigate("/login", { replace: true });
                  },
                  onError: (error) => {
                    toast.error(error.error.message);
                  },
                },
              });
            }}
          >
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
