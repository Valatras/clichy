import { useRef, useState } from "react";

import type { Route } from "./+types/_index";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Clichy — Photo Library" },
    {
      name: "description",
      content: "A simple and powerful photo library.",
    },
  ];
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (file) {
      setSelectedFile(file);
    }
  }

  return (
    <main className="min-h-[calc(100vh-4rem)]">
      {/* Hero */}
      <section className="border-b">
        <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <div className="max-w-3xl">
            <p className="mb-4 text-sm font-medium uppercase tracking-widest text-muted-foreground">
              Photo Library
            </p>

            <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">
              Your photos.
              <br />
              <span className="text-muted-foreground">All in one place.</span>
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
              Clichy is a personal photo library designed to store, organize
              and eventually help you manage your entire collection.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                Add photos
              </button>

              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleFileChange}
              />

              <span className="text-sm text-muted-foreground">
                JPG, PNG, WebP or GIF
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Library */}
      <section>
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="mb-6 flex items-end justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                Your library
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {selectedFile
                  ? `Selected: ${selectedFile.name}`
                  : "Your uploaded photos will appear here."}
              </p>
            </div>

            <span className="text-sm text-muted-foreground">0 photos</span>
          </div>

          {/* Empty state */}
          <div className="flex min-h-80 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 px-6 text-center">
            <div className="mb-5 flex size-14 items-center justify-center rounded-full border bg-background">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="size-6 text-muted-foreground"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m2.25 15.75 3.75-3.75 3 3L15.75 8.25l6 6"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 19.5h18"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5.25 19.5A2.25 2.25 0 0 1 3 17.25V6.75A2.25 2.25 0 0 1 5.25 4.5h13.5A2.25 2.25 0 0 1 21 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25"
                />
              </svg>
            </div>

            <h3 className="font-medium">Your library is empty</h3>

            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Upload your first photo to start building your personal
              collection.
            </p>

            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-5 rounded-md border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
            >
              Choose a photo
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
