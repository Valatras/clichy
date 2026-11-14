import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  CloudUpload,
  Download,
  Image as ImageIcon,
  ImageOff,
  LoaderCircle,
  Menu,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { Link, Navigate } from "react-router";
import { toast } from "sonner";

import { Button } from "@clichy/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@clichy/ui/components/dropdown-menu";
import { Input } from "@clichy/ui/components/input";
import { authClient } from "@/lib/auth-client";

import { BrandLogo } from "../components/brand-logo";
import Header from "../components/header";
import { ModalDialog } from "../components/modal-dialog";
import type { Route } from "./+types/_index";

type ProcessingStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
type SortOrder = "newest" | "name" | "size";

type Photo = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  processingStatus: ProcessingStatus;
  createdAt: string;
};

type PhotoMetadata = Photo & {
  imageFormat: string | null;
  orientation: number | null;
  dateTaken: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  exposureTime: number | null;
  aperture: number | null;
  iso: number | null;
  focalLength: number | null;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
};

type PhotoMatch = {
  id: string;
  filename: string;
  mimeType: string;
  size?: number;
  width?: number | null;
  height?: number | null;
  processingStatus?: ProcessingStatus;
  createdAt: string;
  hammingDistance?: number;
};

function photoForMatch(match: PhotoMatch, photos: Photo[]): Photo {
  return (
    photos.find((photo) => photo.id === match.id) ?? {
      id: match.id,
      filename: match.filename,
      mimeType: match.mimeType,
      size: match.size ?? 0,
      width: match.width ?? null,
      height: match.height ?? null,
      processingStatus: match.processingStatus ?? "COMPLETED",
      createdAt: match.createdAt,
    }
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function photoStatus(status: ProcessingStatus): string | null {
  switch (status) {
    case "PENDING":
      return "Waiting for processing";
    case "PROCESSING":
      return "Processing image";
    case "FAILED":
      return "Original saved · preview unavailable";
    case "COMPLETED":
      return null;
  }
}

function PhotoImage({
  photo,
  variant,
  className,
}: {
  photo: Photo;
  variant: "thumbnail" | "medium";
  className?: string;
}) {
  const [useOriginal, setUseOriginal] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    setUseOriginal(false);
    setUnavailable(false);
  }, [photo.id, photo.processingStatus]);

  if (unavailable) {
    return (
      <div
        className={`grid place-items-center bg-muted text-muted-foreground ${className ?? ""}`}
        role="img"
        aria-label={`${photo.filename}: image preview unavailable`}
      >
        <ImageOff className="size-6" aria-hidden="true" />
      </div>
    );
  }

  return (
    <img
      src={
        useOriginal
          ? `/photos/${photo.id}`
          : `/photos/${photo.id}/thumbnail/${variant}`
      }
      alt={photo.filename}
      loading="lazy"
      className={className}
      onError={() => {
        if (!useOriginal) {
          setUseOriginal(true);
        } else {
          setUnavailable(true);
        }
      }}
    />
  );
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Your library · Clichy" },
    {
      name: "description",
      content: "A private home for your photographs.",
    },
  ];
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const detailRequestRef = useRef(0);
  const { data: session, isPending: sessionPending } = authClient.useSession();

  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    completed: number;
    total: number;
    filename: string;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [metadata, setMetadata] = useState<PhotoMetadata | null>(null);
  const [duplicates, setDuplicates] = useState<PhotoMatch[]>([]);
  const [similarPhotos, setSimilarPhotos] = useState<PhotoMatch[]>([]);
  const [duplicatesLoaded, setDuplicatesLoaded] = useState(false);
  const [similarLoaded, setSimilarLoaded] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [pendingDeletion, setPendingDeletion] = useState<Photo[] | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadPhotos = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      setError(null);
      const response = await fetch("/photos", { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load your library.");
      setPhotos(await response.json());
    } catch (loadError) {
      console.error(loadError);
      setError("We couldn’t load your photos. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session && !sessionPending) {
      void loadPhotos();
    }
  }, [loadPhotos, session, sessionPending]);

  const visiblePhotos = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const matching = photos.filter((photo) =>
      photo.filename.toLocaleLowerCase().includes(query),
    );
    return matching.sort((left, right) => {
      if (sortOrder === "name") {
        return left.filename.localeCompare(right.filename);
      }
      if (sortOrder === "size") {
        return right.size - left.size;
      }
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });
  }, [photos, search, sortOrder]);

  useEffect(() => {
    if (
      !session ||
      sessionPending ||
      !visiblePhotos.some(
        (photo) =>
          photo.processingStatus === "PENDING" ||
          photo.processingStatus === "PROCESSING",
      )
    ) {
      return;
    }

    let stopped = false;
    let delay = 2500;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (stopped) return;
      if (!document.hidden) {
        try {
          const response = await fetch("/photos", { credentials: "include" });
          if (!response.ok) throw new Error("Unable to refresh photo statuses");
          setPhotos(await response.json());
          delay = 2500;
        } catch (pollError) {
          console.warn("Photo status refresh failed; retrying", pollError);
          delay = Math.min(delay * 2, 15000);
        }
      }
      if (!stopped) timer = setTimeout(() => void poll(), delay);
    };

    timer = setTimeout(() => void poll(), delay);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [session, sessionPending, visiblePhotos]);

  async function showPhotoDetails(photo: Photo) {
    detailRequestRef.current += 1;
    const requestId = detailRequestRef.current;
    setSelectedPhoto(photo);
    setMetadata(null);
    setDuplicates([]);
    setSimilarPhotos([]);
    setDuplicatesLoaded(false);
    setSimilarLoaded(false);
    setDetailsError(null);
    setDetailsLoading(true);
    setLookupLoading(false);

    try {
      const response = await fetch(`/photos/${photo.id}/metadata`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Unable to load photo details.");
      const details: PhotoMetadata = await response.json();
      if (detailRequestRef.current === requestId) setMetadata(details);
    } catch (detailsLoadError) {
      console.error(detailsLoadError);
      if (detailRequestRef.current === requestId) {
        setDetailsError("We couldn’t load this photo’s details.");
      }
    } finally {
      if (detailRequestRef.current === requestId) setDetailsLoading(false);
    }
  }

  function closeDetails() {
    detailRequestRef.current += 1;
    setSelectedPhoto(null);
    setDetailsLoading(false);
  }

  async function findDuplicates() {
    if (!selectedPhoto) return;
    setLookupLoading(true);
    setDetailsError(null);
    try {
      const response = await fetch(
        `/photos/${selectedPhoto.id}/duplicates`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("Unable to look for exact duplicates.");
      setDuplicates(await response.json());
      setDuplicatesLoaded(true);
    } catch (lookupError) {
      console.error(lookupError);
      setDetailsError("We couldn’t look for exact duplicates. Please retry.");
    } finally {
      setLookupLoading(false);
    }
  }

  async function findSimilarPhotos() {
    if (!selectedPhoto) return;
    setLookupLoading(true);
    setDetailsError(null);
    try {
      const response = await fetch(`/photos/${selectedPhoto.id}/similar`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Unable to look for visually similar photos.");
      const data: { matches: PhotoMatch[] } = await response.json();
      setSimilarPhotos(data.matches);
      setSimilarLoaded(true);
    } catch (lookupError) {
      console.error(lookupError);
      setDetailsError("We couldn’t look for similar photos. Please retry.");
    } finally {
      setLookupLoading(false);
    }
  }

  async function uploadFiles(files: File[]) {
    if (uploading || files.length === 0) return;
    setUploading(true);
    setError(null);
    setUploadProgress({
      completed: 0,
      total: files.length,
      filename: files[0]?.name ?? "",
    });

    let uploaded = 0;
    const failures: string[] = [];
    for (const [index, file] of files.entries()) {
      setUploadProgress({
        completed: index,
        total: files.length,
        filename: file.name,
      });
      try {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch("/photos", {
          method: "POST",
          credentials: "include",
          body: formData,
        });
        if (!response.ok) {
          const result = await response.json().catch(() => null);
          throw new Error(result?.error ?? "Upload failed");
        }
        uploaded += 1;
      } catch (uploadError) {
        console.error(uploadError);
        failures.push(
          `${file.name}: ${uploadError instanceof Error ? uploadError.message : "Upload failed"}`,
        );
      }
    }

    setUploadProgress(null);
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
    if (uploaded > 0) {
      await loadPhotos(false);
      toast.success(
        `${uploaded} ${uploaded === 1 ? "photo added" : "photos added"} to your library`,
      );
    }
    if (failures.length > 0) {
      toast.error(
        failures.length === 1
          ? failures[0]
          : `${failures.length} photos could not be uploaded`,
      );
    }
  }

  function toggleSelection(photoId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }

  function toggleVisibleSelection() {
    setSelectedIds((current) => {
      const next = new Set(current);
      const allSelected = visiblePhotos.every((photo) => next.has(photo.id));
      for (const photo of visiblePhotos) {
        if (allSelected) next.delete(photo.id);
        else next.add(photo.id);
      }
      return next;
    });
  }

  async function deletePhotos() {
    if (!pendingDeletion?.length || deleting) return;
    setDeleting(true);
    let deletedCount = 0;
    let failedName: string | null = null;

    for (const photo of pendingDeletion) {
      try {
        const response = await fetch(`/photos/${photo.id}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (!response.ok) {
          const result = await response.json().catch(() => null);
          throw new Error(result?.error ?? "Unable to delete this photo.");
        }
        deletedCount += 1;
        setPhotos((current) => current.filter((item) => item.id !== photo.id));
        setSelectedIds((current) => {
          const next = new Set(current);
          next.delete(photo.id);
          return next;
        });
        if (selectedPhoto?.id === photo.id) closeDetails();
      } catch (deleteError) {
        console.error(deleteError);
        failedName = photo.filename;
        if (selectedPhoto?.id === photo.id) {
          setDetailsError(
            "We couldn’t delete this photo. It remains in your library. Please try again.",
          );
        }
        break;
      }
    }

    setDeleting(false);
    setPendingDeletion(null);
    if (deletedCount > 0) {
      toast.success(
        deletedCount === 1
          ? "Photo permanently deleted"
          : `${deletedCount} photos permanently deleted`,
      );
    }
    if (failedName) {
      toast.error(`Could not delete ${failedName}. Your photo is still in the library.`);
      await loadPhotos(false);
    }
  }

  function requestDelete(photosToDelete: Photo[]) {
    if (photosToDelete.length > 0) setPendingDeletion(photosToDelete);
  }

  function openFilePicker() {
    if (!uploading) inputRef.current?.click();
  }

  if (sessionPending) {
    return (
      <main className="grid min-h-svh place-items-center" aria-busy="true">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <BrandLogo className="h-10 w-auto animate-pulse text-foreground" />
          <span className="text-sm">Opening your library…</span>
        </div>
      </main>
    );
  }

  if (!session) return <Navigate to="/login" replace />;

  const selectedPhotos = photos.filter((photo) => selectedIds.has(photo.id));
  const allVisibleSelected =
    visiblePhotos.length > 0 &&
    visiblePhotos.every((photo) => selectedIds.has(photo.id));

  return (
    <main
      className="min-h-svh"
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes("Files") && !uploading) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void uploadFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="min-h-svh lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)]">
        <aside className="hidden border-r border-sidebar-border bg-sidebar px-5 py-6 lg:flex lg:flex-col">
          <Link
            to="/"
            className="mb-12 inline-flex w-fit items-center"
            aria-label="Clichy library"
          >
            <BrandLogo className="h-10 w-auto text-sidebar-foreground" />
          </Link>
          <nav aria-label="Main navigation">
            <Link
              to="/"
              aria-current="page"
              className="flex items-center gap-3 rounded-xl bg-sidebar-accent px-3 py-3 text-sm font-medium text-sidebar-accent-foreground"
            >
              <ImageIcon className="size-[18px]" aria-hidden="true" />
              Library
            </Link>
          </nav>
          <div className="mt-8 border-t border-sidebar-border pt-5">
            <p className="px-3 text-xs font-medium text-muted-foreground">
              Photo review
            </p>
            <p className="mt-2 px-3 text-xs leading-5 text-muted-foreground">
              Exact copies and visually similar photos are available from each photo’s details.
            </p>
          </div>
          <div className="mt-auto rounded-2xl bg-background/70 p-4">
            <div className="mb-3 flex size-9 items-center justify-center rounded-full bg-secondary text-primary">
              <ShieldCheck className="size-4" aria-hidden="true" />
            </div>
            <p className="text-sm font-medium">Your photos, your space</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Your library is private to your account.
            </p>
          </div>
        </aside>

        <div className="flex min-h-svh min-w-0 flex-col">
          <Header />
          <section className="mx-auto w-full max-w-[1600px] flex-1 px-4 pb-20 pt-7 sm:px-7 sm:pt-10 lg:px-10">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                  Your collection
                </p>
                <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">
                  Library
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  {loading
                    ? "Getting your photos…"
                    : `${photos.length} ${photos.length === 1 ? "photo" : "photos"} in your collection`}
                </p>
              </div>
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  multiple
                  className="sr-only"
                  aria-label="Choose photos to upload"
                  onChange={(event) => {
                    void uploadFiles(Array.from(event.target.files ?? []));
                  }}
                />
                <Button
                  type="button"
                  onClick={openFilePicker}
                  disabled={uploading}
                  className="h-10 flex-1 rounded-full px-4 text-sm sm:flex-none"
                >
                  {uploading ? (
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                  ) : (
                    <CloudUpload aria-hidden="true" />
                  )}
                  {uploading ? "Adding photos…" : "Add photos"}
                </Button>
              </div>
            </div>

            {uploadProgress && (
              <div
                className="mb-6 flex items-center gap-3 rounded-xl bg-secondary/70 px-4 py-3 text-sm"
                role="status"
                aria-live="polite"
              >
                <LoaderCircle className="size-4 animate-spin text-primary" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">
                  Adding {uploadProgress.filename}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {uploadProgress.completed + 1} of {uploadProgress.total}
                </span>
              </div>
            )}

            {photos.length > 0 && (
              <div className="mb-5 flex flex-wrap items-center gap-3">
                <label className="relative min-w-[min(100%,16rem)] flex-1 sm:max-w-sm">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search by filename"
                    aria-label="Search photos by filename"
                    className="h-10 rounded-full border-border/80 bg-card pl-10 text-sm"
                  />
                </label>
                <label className="relative">
                  <SlidersHorizontal
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <select
                    value={sortOrder}
                    onChange={(event) => setSortOrder(event.target.value as SortOrder)}
                    aria-label="Sort photos"
                    className="h-10 appearance-none rounded-full border border-border/80 bg-card py-2 pl-9 pr-9 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="newest">Newest first</option>
                    <option value="name">Name</option>
                    <option value="size">Largest first</option>
                  </select>
                  <ChevronDown
                    className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={toggleVisibleSelection}
                  className="h-10 rounded-full px-3 text-sm"
                  disabled={visiblePhotos.length === 0}
                >
                  <Check aria-hidden="true" />
                  {allVisibleSelected ? "Clear visible" : "Select photos"}
                </Button>
              </div>
            )}

            {selectedPhotos.length > 0 && (
              <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3">
                <span className="text-sm font-medium" aria-live="polite">
                  {selectedPhotos.length} selected
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedIds(new Set())}
                  className="rounded-full"
                >
                  Clear selection
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => requestDelete(selectedPhotos)}
                  className="ml-auto rounded-full"
                >
                  <Trash2 aria-hidden="true" />
                  Delete selected
                </Button>
              </div>
            )}

            {error ? (
              <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-border/70 bg-card px-6 text-center">
                <p className="text-sm text-destructive">{error}</p>
                <Button
                  variant="outline"
                  onClick={() => void loadPhotos()}
                  className="mt-4 rounded-full"
                >
                  Try again
                </Button>
              </div>
            ) : loading ? (
              <div
                className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4 2xl:grid-cols-5"
                aria-label="Loading photos"
              >
                {Array.from({ length: 10 }, (_, index) => (
                  <div
                    key={index}
                    className="aspect-[4/3] animate-pulse rounded-2xl bg-muted"
                  />
                ))}
              </div>
            ) : photos.length === 0 ? (
              <div
                className={`flex min-h-[min(64vh,38rem)] flex-col items-center justify-center rounded-3xl border border-dashed px-6 text-center transition-colors ${
                  dragging
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card/60"
                }`}
              >
                <div className="mb-5 grid size-14 place-items-center rounded-2xl bg-secondary text-primary">
                  <ImageIcon className="size-6" aria-hidden="true" />
                </div>
                <h2 className="font-serif text-2xl tracking-tight">
                  A little room for your memories
                </h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                  Add your first photos to begin building a personal collection.
                  You can also drop image files anywhere on this page.
                </p>
                <Button
                  type="button"
                  onClick={openFilePicker}
                  className="mt-6 h-10 rounded-full px-5"
                >
                  <CloudUpload aria-hidden="true" />
                  Choose photos
                </Button>
                <p className="mt-4 text-xs text-muted-foreground">
                  JPEG, PNG, WebP or GIF · up to 20 MB each
                </p>
              </div>
            ) : visiblePhotos.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-border/70 bg-card px-6 text-center">
                <Search className="mb-4 size-6 text-muted-foreground" aria-hidden="true" />
                <h2 className="font-serif text-xl">No photos match that name</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Try another filename or clear your search.
                </p>
                <Button
                  variant="ghost"
                  onClick={() => setSearch("")}
                  className="mt-3 rounded-full"
                >
                  Clear search
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4 2xl:grid-cols-5">
                {visiblePhotos.map((photo) => {
                  const ratio =
                    photo.width && photo.height
                      ? Math.min(1.8, Math.max(0.68, photo.width / photo.height))
                      : 1;
                  const status = photoStatus(photo.processingStatus);
                  const selected = selectedIds.has(photo.id);
                  return (
                    <article
                      key={photo.id}
                      className={`group relative min-w-0 overflow-hidden rounded-2xl bg-muted ring-1 ring-foreground/5 transition-[box-shadow,transform] hover:shadow-lg ${
                        selected ? "ring-2 ring-primary" : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => void showPhotoDetails(photo)}
                        className="relative block w-full overflow-hidden bg-muted text-left focus-visible:z-10 focus-visible:outline"
                        style={{ aspectRatio: ratio }}
                        aria-label={`Open ${photo.filename}`}
                      >
                        <PhotoImage
                          photo={photo}
                          variant="thumbnail"
                          className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.025]"
                        />
                        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent px-3 pb-3 pt-10 text-left text-xs font-medium text-white opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                          <span className="block truncate">{photo.filename}</span>
                          <span className="mt-1 block text-white/75">
                            {formatSize(photo.size)}
                          </span>
                        </span>
                        {status && (
                          <span className="absolute left-2 top-2 rounded-full bg-background/90 px-2.5 py-1 text-[11px] font-medium text-foreground shadow-sm">
                            {status}
                          </span>
                        )}
                      </button>
                      <div className="absolute right-2 top-2 flex items-center gap-1">
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon"
                          aria-label={`${selected ? "Deselect" : "Select"} ${photo.filename}`}
                          aria-pressed={selected}
                          onClick={() => toggleSelection(photo.id)}
                          className={`size-9 rounded-full border border-white/50 shadow-sm ${
                            selected
                              ? "bg-primary text-primary-foreground"
                              : "bg-background/90 text-foreground sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                          }`}
                        >
                          {selected ? (
                            <Check aria-hidden="true" />
                          ) : (
                            <span className="size-3 rounded-full border-2 border-current" aria-hidden="true" />
                          )}
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                type="button"
                                variant="secondary"
                                size="icon"
                                aria-label={`More actions for ${photo.filename}`}
                                className="size-9 rounded-full border border-white/50 bg-background/90 text-foreground shadow-sm sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                              />
                            }
                          >
                            <Menu aria-hidden="true" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => void showPhotoDetails(photo)}>
                              <ImageIcon aria-hidden="true" />
                              View details
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              render={
                                <a
                                  href={`/photos/${photo.id}`}
                                  download={photo.filename}
                                />
                              }
                            >
                              <Download aria-hidden="true" />
                              Download original
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => requestDelete([photo])}
                            >
                              <Trash2 aria-hidden="true" />
                              Delete photo
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
          <footer className="mt-auto border-t border-border/60 px-5 py-4 text-center text-xs text-muted-foreground lg:text-left lg:px-10">
            A private home for the photos you want to keep.
          </footer>
        </div>
      </div>

      {dragging && (
        <div className="pointer-events-none fixed inset-3 z-40 grid place-items-center rounded-3xl border-2 border-dashed border-primary bg-background/90 text-center shadow-xl">
          <div>
            <CloudUpload className="mx-auto size-10 text-primary" aria-hidden="true" />
            <p className="mt-3 font-medium">Drop photos to add them to your library</p>
          </div>
        </div>
      )}

      <ModalDialog
        open={selectedPhoto !== null}
        onClose={closeDetails}
        labelledBy="photo-details-title"
        className="fixed inset-y-0 right-0 m-0 h-dvh w-full max-w-3xl border-0 border-l border-border bg-background p-0 text-foreground shadow-2xl"
      >
        {selectedPhoto && (
          <>
            <div className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4 sm:px-7">
              <div className="min-w-0">
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.13em] text-primary">
                  Photo details
                </p>
                <h2
                  id="photo-details-title"
                  className="truncate font-serif text-xl tracking-tight sm:text-2xl"
                >
                  {selectedPhoto.filename}
                </h2>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Close photo details"
                onClick={closeDetails}
                className="shrink-0 rounded-full"
                autoFocus
              >
                <X aria-hidden="true" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
              <div className="overflow-hidden rounded-2xl bg-muted">
                <div className="grid min-h-56 max-h-[52vh] place-items-center">
                  <PhotoImage
                    photo={selectedPhoto}
                    variant="medium"
                    className="max-h-[52vh] max-w-full object-contain"
                  />
                </div>
              </div>

              {detailsLoading && (
                <p className="mt-5 text-sm text-muted-foreground" role="status">
                  Loading photo details…
                </p>
              )}
              {detailsError && (
                <p className="mt-5 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
                  {detailsError}
                </p>
              )}

              <section className="mt-6">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="font-medium">About this photo</h3>
                  {metadata?.processingStatus === "FAILED" && (
                    <span className="rounded-full bg-warning/15 px-3 py-1 text-xs font-medium">
                      Original saved · preview unavailable
                    </span>
                  )}
                  {(metadata?.processingStatus === "PENDING" ||
                    metadata?.processingStatus === "PROCESSING") && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-medium">
                      <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
                      Preparing preview
                    </span>
                  )}
                </div>
                <dl className="grid grid-cols-[minmax(7rem,0.7fr)_minmax(0,1.3fr)] gap-x-4 gap-y-3 rounded-2xl bg-muted/60 p-4 text-sm sm:grid-cols-[9rem_1fr] sm:p-5">
                  <dt className="text-muted-foreground">File size</dt>
                  <dd>{formatSize(metadata?.size ?? selectedPhoto.size)}</dd>
                  <dt className="text-muted-foreground">Dimensions</dt>
                  <dd>
                    {metadata?.width && metadata.height
                      ? `${metadata.width} × ${metadata.height}`
                      : "Not available"}
                  </dd>
                  <dt className="text-muted-foreground">Format</dt>
                  <dd className="uppercase">
                    {metadata?.imageFormat ?? selectedPhoto.mimeType.replace("image/", "")}
                  </dd>
                  <dt className="text-muted-foreground">Date added</dt>
                  <dd>{new Date(selectedPhoto.createdAt).toLocaleDateString()}</dd>
                  <dt className="text-muted-foreground">Date taken</dt>
                  <dd>
                    {metadata?.dateTaken
                      ? new Date(metadata.dateTaken).toLocaleString()
                      : "Not available"}
                  </dd>
                  <dt className="text-muted-foreground">Camera</dt>
                  <dd>
                    {[metadata?.cameraMake, metadata?.cameraModel].filter(Boolean).join(" ") ||
                      "Not available"}
                  </dd>
                  {metadata?.focalLength && (
                    <>
                      <dt className="text-muted-foreground">Focal length</dt>
                      <dd>{metadata.focalLength} mm</dd>
                    </>
                  )}
                  {metadata?.aperture && (
                    <>
                      <dt className="text-muted-foreground">Aperture</dt>
                      <dd>f/{metadata.aperture}</dd>
                    </>
                  )}
                  {metadata?.iso && (
                    <>
                      <dt className="text-muted-foreground">ISO</dt>
                      <dd>{metadata.iso}</dd>
                    </>
                  )}
                </dl>
              </section>

              <section className="mt-7 border-t border-border/70 pt-6">
                <h3 className="font-medium">Review this photo</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Look for exact copies or other shots with a similar appearance.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void findDuplicates()}
                    disabled={lookupLoading || metadata?.processingStatus !== "COMPLETED"}
                    className="h-10 rounded-full px-4"
                  >
                    {lookupLoading && !duplicatesLoaded ? (
                      <LoaderCircle className="animate-spin" aria-hidden="true" />
                    ) : (
                      <ImageIcon aria-hidden="true" />
                    )}
                    Find exact copies
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void findSimilarPhotos()}
                    disabled={lookupLoading || metadata?.processingStatus !== "COMPLETED"}
                    className="h-10 rounded-full px-4"
                  >
                    {lookupLoading && !similarLoaded ? (
                      <LoaderCircle className="animate-spin" aria-hidden="true" />
                    ) : (
                      <ImageIcon aria-hidden="true" />
                    )}
                    Find similar photos
                  </Button>
                </div>
                {duplicatesLoaded && (
                  <div className="mt-5">
                    <h4 className="text-sm font-medium">
                      Exact copies <span className="text-muted-foreground">({duplicates.length})</span>
                    </h4>
                    {duplicates.length > 0 ? (
                      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {duplicates.map((match) => {
                          const photo = photoForMatch(match, photos);
                          return (
                            <button
                              type="button"
                              key={match.id}
                              onClick={() => void showPhotoDetails(photo)}
                              className="group min-w-0 text-left"
                            >
                              <div className="aspect-[4/3] overflow-hidden rounded-xl bg-muted">
                                <PhotoImage
                                  photo={photo}
                                  variant="thumbnail"
                                  className="size-full object-cover transition-transform group-hover:scale-105"
                                />
                              </div>
                              <span className="mt-2 block truncate text-xs font-medium">
                                {match.filename}
                              </span>
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                Same image file
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">
                        No exact copies were found in your library.
                      </p>
                    )}
                  </div>
                )}
                {similarLoaded && (
                  <div className="mt-5">
                    <h4 className="text-sm font-medium">
                      Visually similar <span className="text-muted-foreground">({similarPhotos.length})</span>
                    </h4>
                    {similarPhotos.length > 0 ? (
                      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {similarPhotos.map((match) => {
                          const photo = photoForMatch(match, photos);
                          return (
                            <button
                              type="button"
                              key={match.id}
                              onClick={() => void showPhotoDetails(photo)}
                              className="group min-w-0 text-left"
                            >
                              <div className="aspect-[4/3] overflow-hidden rounded-xl bg-muted">
                                <PhotoImage
                                  photo={photo}
                                  variant="thumbnail"
                                  className="size-full object-cover transition-transform group-hover:scale-105"
                                />
                              </div>
                              <span className="mt-2 block truncate text-xs font-medium">
                                {match.filename}
                              </span>
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                Similar appearance · not necessarily identical
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">
                        No visually similar photos were found.
                      </p>
                    )}
                  </div>
                )}
              </section>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-border/70 px-5 py-4 sm:px-7">
              <Button
                type="button"
                variant="outline"
                nativeButton={false}
                render={
                  <a
                    href={`/photos/${selectedPhoto.id}`}
                    download={selectedPhoto.filename}
                  />
                }
                className="h-10 rounded-full"
              >
                <Download aria-hidden="true" />
                Download original
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => requestDelete([selectedPhoto])}
                className="ml-auto h-10 rounded-full"
              >
                <Trash2 aria-hidden="true" />
                Delete photo
              </Button>
            </div>
          </>
        )}
      </ModalDialog>

      <ModalDialog
        open={pendingDeletion !== null}
        onClose={() => {
          if (!deleting) setPendingDeletion(null);
        }}
        labelledBy="delete-confirmation-title"
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-3xl border border-border bg-card p-0 text-card-foreground shadow-2xl"
      >
        {pendingDeletion && (
          <div className="p-6 sm:p-7">
            <div className="mb-5 grid size-11 place-items-center rounded-full bg-destructive/10 text-destructive">
              <Trash2 className="size-5" aria-hidden="true" />
            </div>
            <h2 id="delete-confirmation-title" className="font-serif text-2xl tracking-tight">
              {pendingDeletion.length === 1
                ? "Delete this photo?"
                : `Delete ${pendingDeletion.length} photos?`}
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {pendingDeletion.length === 1 ? (
                <>
                  <span className="font-medium text-foreground">
                    {pendingDeletion[0]?.filename}
                  </span>{" "}
                  will be permanently deleted, including its original file and
                  previews. This can’t be undone.
                </>
              ) : (
                <>
                  The selected photos, their original files, and previews will
                  be permanently deleted. This can’t be undone.
                </>
              )}
            </p>
            {pendingDeletion.length > 1 && (
              <ul className="mt-3 max-h-24 space-y-1 overflow-y-auto rounded-xl bg-muted/70 p-3 text-xs text-muted-foreground">
                {pendingDeletion.slice(0, 5).map((photo) => (
                  <li key={photo.id} className="truncate">{photo.filename}</li>
                ))}
                {pendingDeletion.length > 5 && (
                  <li>and {pendingDeletion.length - 5} more</li>
                )}
              </ul>
            )}
            <div className="mt-7 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setPendingDeletion(null)}
                disabled={deleting}
                autoFocus
                className="h-10 rounded-full px-4"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void deletePhotos()}
                disabled={deleting}
                className="h-10 rounded-full px-4"
              >
                {deleting ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 aria-hidden="true" />
                )}
                {deleting ? "Deleting…" : "Delete permanently"}
              </Button>
            </div>
          </div>
        )}
      </ModalDialog>
    </main>
  );
}
