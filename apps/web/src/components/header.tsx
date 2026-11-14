import { Link } from "react-router";
import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";
import { BrandLogo } from "./brand-logo";

export default function Header() {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-border/70 px-4 py-3 sm:px-7 lg:px-10">
      <Link
        to="/"
        aria-label="Clichy library"
        className="inline-flex items-center lg:hidden"
      >
        <BrandLogo className="h-9 w-auto" />
      </Link>
      <div className="flex items-center gap-1">
        <ModeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
