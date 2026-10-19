import { useEffect, useRef, useState } from "react";

import type { Route } from "./+types/_index";

type Photo = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
};

type LoadedPhoto = Photo & {
  url: string;
};

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

  const [photos, setPhotos] = useState<LoadedPhoto[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [podName, setPodName] = useState<string | null>(null);
  const [podLoading, setPodLoading] = useState(false);
  const [podError, setPodError] = useState<string | null>(null);

  async function loadPhotos() {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch("/photos", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to load photos");
      }

      const data: Photo[] = await response.json();

      const loadedPhotos = await Promise.all(
        data.map(async (photo) => {
          const imageResponse = await fetch(`/photos/${photo.id}`, {
            credentials: "include",
          });

          if (!imageResponse.ok) {
            throw new Error(`Failed to load ${photo.filename}`);
          }

          const blob = await imageResponse.blob();

          return {
            ...photo,
            url: URL.createObjectURL(blob),
          };
        }),
      );

      setPhotos((previous) => {
        previous.forEach((photo) => URL.revokeObjectURL(photo.url));
        return loadedPhotos;
      });
    } catch (err) {
      console.error(err);
      setError("Unable to load your photos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPhotos();

    return () => {
      photos.forEach((photo) => URL.revokeObjectURL(photo.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleFileChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setSelectedFile(file);
    setError(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/photos", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);

        throw new Error(
          data?.error ?? "Failed to upload photo",
        );
      }

      setSelectedFile(null);

      if (inputRef.current) {
        inputRef.current.value = "";
      }

      await loadPhotos();
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : "Unable to upload the photo.",
      );
    } finally {
      setUploading(false);
    }
  }

  function openFilePicker() {
    if (!uploading) {
      inputRef.current?.click();
    }
  }

  async function showServingPod() {
    setPodLoading(true);
    setPodError(null);

    try {
      const response = await fetch("/pod", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Unable to identify the serving pod.");
      }

      const data: { podName: string } = await response.json();
      setPodName(data.podName);
    } catch (err) {
      console.error(err);
      setPodError("Unable to identify the serving pod.");
    } finally {
      setPodLoading(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-4rem)]">
      {/* Hero */}
      <section className="border-b">
        <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <div className="max-w-3xl">
            <p className="mb-4 text-sm font-medium uppercase tracking-widest text-muted-foreground">
              Photo Library V3
            </p>

            <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">
              Your photos.
              <br />
              <span className="text-muted-foreground">
                All in one place.
              </span>
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
              Clichy is a personal photo library designed to store,
              organize and manage your entire collection.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={openFilePicker}
                disabled={uploading}
                className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploading ? "Uploading..." : "Add photo"}
              </button>

              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleFileChange}
              />

              <span className="text-sm text-muted-foreground">
                JPG, PNG, WebP or GIF · max 20 MB
              </span>
              <button
                type="button"
                onClick={showServingPod}
                disabled={podLoading}
                className="rounded-md border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                {podLoading ? "Checking..." : "Show serving pod"}
              </button>
            </div>

            {podName && (
              <p className="mt-3 text-sm text-muted-foreground">
                Served by pod: <strong>{podName}</strong>
              </p>
            )}

            {podError && (
              <p className="mt-3 text-sm text-destructive">{podError}</p>
            )}

            {selectedFile && uploading && (
              <p className="mt-4 text-sm text-muted-foreground">
                Uploading <strong>{selectedFile.name}</strong>...
              </p>
            )}

            {error && (
              <p className="mt-4 text-sm text-destructive">
                {error}
              </p>
            )}
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
                {loading
                  ? "Loading your photos..."
                  : photos.length === 0
                    ? "Your uploaded photos will appear here."
                    : `${photos.length} ${
                        photos.length === 1 ? "photo" : "photos"
                      }`}
              </p>
            </div>

            {!loading && photos.length > 0 && (
              <span className="text-sm text-muted-foreground">
                {photos.length} photos
              </span>
            )}
          </div>

          {loading ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <div
                  key={index}
                  className="aspect-square animate-pulse rounded-xl bg-muted"
                />
              ))}
            </div>
          ) : photos.length === 0 ? (
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
                  <rect
                    x="3"
                    y="3"
                    width="18"
                    height="18"
                    rx="2"
                  />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="m21 15-5-5L5 21" />
                </svg>
              </div>

              <h3 className="font-medium">
                Your library is empty
              </h3>

              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Upload your first photo to start building your
                personal collection.
              </p>

              <button
                type="button"
                onClick={openFilePicker}
                className="mt-5 rounded-md border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
              >
                Choose a photo
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {photos.map((photo) => (
                <article
                  key={photo.id}
                  className="group overflow-hidden rounded-xl border bg-card"
                >
                  <div className="aspect-square overflow-hidden bg-muted">
                    <img
                      src={photo.url}
                      alt={photo.filename}
                      className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  </div>

                  <div className="p-3">
                    <p
                      className="truncate text-sm font-medium"
                      title={photo.filename}
                    >
                      {photo.filename}
                    </p>

                    <p className="mt-1 text-xs text-muted-foreground">
                      {(photo.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
