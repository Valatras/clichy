# Clichy web app

The web app is a responsive private photo library built with React Router,
Tailwind CSS, Better Auth, and the shared `@clichy/ui` package.

## Library experience

- `/` is the authenticated library. It shows generated thumbnail previews,
  filename search, sorting, sequential multi-photo upload, selection, and
  permanent deletion.
- Opening a photo shows its metadata, original download, exact-copy matches,
  and visually similar photos.
- `/login` provides sign-in and account creation. Unauthenticated visits to the
  library are redirected there; authenticated visits go to the library.
- `/dashboard` remains a compatibility redirect to the library.

Original photo downloads and all photo-management API requests use the
authenticated `/photos` routes. Image uploads are sent sequentially to respect
the server's bounded processing capacity.

## Local development

Configure `apps/web/.env` as described in the
[main README](../../README.md#démarrage-local), then run from the repository
root:

```bash
pnpm run dev:web
```

The web app uses same-origin API paths such as `/api/auth` and `/photos`. The
route proxy and deployment image are configured in the existing React Router
and Docker setup. Shared interface tokens and primitives are in
[`packages/ui/`](../../packages/ui/).

The custom Clichy logo is in `public/brand/`, with a reusable React component
in `src/components/brand-logo.tsx`. See the
[brand guidelines](../../docs/design/brand-guidelines.md) for identity and
theme usage.

Infrastructure monitoring remains available through its private
administrative URLs and is intentionally not linked from the consumer UI.
