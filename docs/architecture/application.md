# Application components

## Web

`apps/web` is a React Router application built with Vite. File-system route setup is in `apps/web/src/routes.ts`; visible routes include index, login, and dashboard. Components include login/sign-up forms and user menu. The browser API origin is supplied through `VITE_SERVER_URL`; production image build currently passes `http://localhost:3000`, so deployments that need another public API origin must review the build argument and routing assumptions.

## API and authentication

`apps/server/src/index.ts` creates a Fastify server on port 3000, enables multipart uploads (20 MiB maximum), CORS with credentials, exposes `/metrics`, mounts photo routes, and adapts Better Auth under `/api/auth/*`. Better Auth uses Prisma/PostgreSQL and email/password auth. Fastify's logger is enabled. Route handlers return explicit errors for unauthenticated requests, missing input, unsupported images, and missing records; unexpected errors are passed to Fastify's handler.

Key routes in `apps/server/src/routes/photos.ts`:

| Method/path | Purpose |
|---|---|
| `GET /photos` | List the authenticated user's photos |
| `POST /photos` | Validate and save upload; create record and return 202 pending processing |
| `GET /photos/:id/metadata` | Read metadata for an owned photo |
| `GET /photos/:id/thumbnail/:variant` | Read an owned derivative variant |
| `GET /photos/:id` | Retrieve original photo content |
| `GET /photos/:id/duplicates` | Find exact SHA-256 matches owned by the user |
| `GET /photos/:id/similar` | Rank candidates by pHash distance; accepts threshold and limit |
| `DELETE /photos/:id` | Delete an owned photo and its stored files |

Auth route surface is Better Auth's handler; consult `packages/auth/src/index.ts` and Better Auth config for exact behavior.

## Image pipeline

`apps/server/src/image-processing.ts` validates and decodes JPEG, PNG, WebP, and GIF using Sharp with a 40-million-pixel cap. It extracts optional EXIF via Exifr, generates SHA-256 and a 64-bit DCT perceptual hash, and writes resized WebP variants. pHash comparison uses Hamming distance in query helpers; this is a similarity primitive, not evidence of a complete duplicate review interface. Video support was not found.

`apps/server/src/storage.ts` implements local filesystem storage. Production mounts the same photos PVC into API and worker. This storage design makes shared writable filesystem semantics a runtime dependency.

## Error handling and logging

Fastify logger handles API logs; worker logs structured JSON to stdout/stderr. Image validation errors and missing original files are permanent BullMQ failures; other errors can retry. Tests are Node test runner via `tsx --test`; test files are colocated in server and worker packages. No dedicated lint script is declared at root.
