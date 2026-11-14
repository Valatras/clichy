import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { Aperture, ShieldCheck } from "lucide-react";

import { ModeToggle } from "@/components/mode-toggle";
import { BrandLogo } from "@/components/brand-logo";
import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";
import { authClient } from "@/lib/auth-client";

export default function Login() {
  const [searchParams] = useSearchParams();
  const [showSignIn, setShowSignIn] = useState(
    searchParams.get("mode") === "signin",
  );
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <main className="grid min-h-svh place-items-center" aria-busy="true">
        <BrandLogo className="h-10 w-auto animate-pulse" />
      </main>
    );
  }

  if (session) {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="min-h-svh bg-background">
      <header className="flex items-center justify-between px-5 py-4 sm:px-8">
        <Link to="/login" aria-label="Clichy home">
          <BrandLogo className="h-9 w-auto" />
        </Link>
        <ModeToggle />
      </header>

      <div className="mx-auto grid min-h-[calc(100svh-4.5rem)] max-w-7xl items-center gap-8 px-5 pb-8 sm:px-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(24rem,0.95fr)] lg:gap-16 lg:px-14">
        <section className="hidden max-w-xl lg:block">
          <div className="mb-9 inline-flex size-14 items-center justify-center rounded-2xl bg-secondary text-primary">
            <Aperture className="size-7" strokeWidth={1.6} aria-hidden="true" />
          </div>
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            A home for your photographs
          </p>
          <h1 className="font-serif text-5xl leading-[1.08] tracking-tight text-foreground xl:text-6xl">
            Keep the moments
            <br />
            <span className="text-primary">that make a life.</span>
          </h1>
          <p className="mt-6 max-w-md text-base leading-7 text-muted-foreground">
            Your own private library for the photographs you want to keep close.
          </p>
          <div className="mt-12 flex items-center gap-3 text-sm text-muted-foreground">
            <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
            Your collection stays yours.
          </div>
        </section>

        <section
          aria-labelledby="auth-heading"
          className="mx-auto w-full max-w-md rounded-3xl border border-border/70 bg-card p-6 shadow-sm sm:p-9"
        >
          <div className="mb-7 lg:hidden">
            <p className="text-sm text-muted-foreground">
              Your own private photo library.
            </p>
          </div>
          <div className="mb-7">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              {showSignIn ? "Welcome back" : "Start your collection"}
            </p>
            <h2
              id="auth-heading"
              className="mt-2 font-serif text-3xl tracking-tight"
            >
              {showSignIn ? "Sign in to Clichy" : "Create your account"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {showSignIn
                ? "Pick up where your photo collection left off."
                : "A considered place for all the photos that matter."}
            </p>
          </div>
          {showSignIn ? (
            <SignInForm onSwitchToSignUp={() => setShowSignIn(false)} />
          ) : (
            <SignUpForm onSwitchToSignIn={() => setShowSignIn(true)} />
          )}
        </section>
      </div>
    </main>
  );
}
