import { NavLink } from "react-router";

import { buttonVariants } from "@clichy/ui/components/button";

import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

export default function Header() {
  const links = [
    { to: "/", label: "Home" },
    { to: "/dashboard", label: "Dashboard" },
  ] as const;

  return (
    <div>
      <div className="flex flex-row flex-wrap items-center justify-between gap-2 px-2 py-1">
        <nav className="flex gap-4 text-lg">
          {links.map(({ to, label }) => {
            return (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => (isActive ? "font-bold" : "")}
                end
              >
                {label}
              </NavLink>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          <a
            href="http://valtask:3000"
            className={buttonVariants({ variant: "outline", size: "sm" })}
            target="_blank"
            rel="noreferrer"
          >
            Grafana
          </a>
          <a
            href="http://valtask:4466"
            className={buttonVariants({ variant: "outline", size: "sm" })}
            target="_blank"
            rel="noreferrer"
          >
            Headlamp
          </a>
          <ModeToggle />
          <UserMenu />
        </div>
      </div>
      <hr />
    </div>
  );
}
