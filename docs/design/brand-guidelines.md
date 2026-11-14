# Clichy brand guidelines

Clichy is a private home for personal photo collections. The identity should
feel calm, personal, carefully organized, and trustworthy; photographs remain
the most expressive part of the product.

## Logo

The symbol combines an open letter C with two offset image frames. The frames
suggest a collection without using a literal camera or aperture illustration.
Use the full lockup when the wordmark is needed and the symbol for compact
places such as the favicon.

Assets live in `apps/web/public/brand/`:

- `logo-light.svg`: charcoal lockup for warm, light surfaces.
- `logo-dark.svg`: ivory lockup for dark surfaces.
- `symbol.svg`: standalone charcoal symbol.
- `apps/web/public/favicon.svg`: standalone symbol for browser and application
  tabs.
- `apps/web/src/components/brand-logo.tsx`: reusable, theme-aware React logo.

Keep the logo at its original proportions, leave clear space around it, and do
not recolor, skew, outline, or add effects to the SVG assets. The React logo
uses the active theme's foreground and background colors.

## Color

The palette pairs warm paper and charcoal with a restrained sage accent and a
small clay highlight:

| Role | Light theme | Dark theme | Use |
| --- | --- | --- | --- |
| Background | Warm ivory | Deep warm charcoal | Main canvas |
| Foreground | Charcoal | Soft ivory | Text and primary mark |
| Primary | Deep sage | Light sage | Main actions and active navigation |
| Accent | Muted clay | Soft clay | Small highlights, never large surfaces |
| Secondary | Pale sage/stone | Deep sage/stone | Quiet controls and selected surfaces |
| Destructive | Accessible red | Accessible light red | Permanent or destructive actions |

Semantic success, warning, border, muted, and focus colors are also defined as
CSS variables in `packages/ui/src/styles/globals.css`. Prefer semantic tokens
such as `bg-background`, `text-muted-foreground`, and `text-destructive` over
hard-coded colors.

## Typography

Use the existing system sans-serif stack for controls and supporting text, with
a restrained serif accent for large collection titles. The UI does not fetch
fonts from a third-party host. Keep headings short and legible; use uppercase
tracking sparingly for small section labels.

## Layout and components

- Let the photographs carry color and personality; use quiet surfaces around
  them.
- Use consistent, generous spacing, with compact controls near the gallery.
- Use rounded image corners and soft, rounded controls; avoid nested bordered
  cards and heavy shadows.
- Reserve shadows for overlays and transient elevation.
- Use Lucide icons with consistent stroke weight and pair icons with visible or
  screen-reader labels.
- Keep destructive actions explicit and visually distinct.
- Make focus states visible and preserve comfortable touch targets on mobile.

## Themes and motion

Light and dark modes share the same semantic hierarchy. Use the theme tokens so
text, surfaces, borders, and focus rings remain legible in either mode. Avoid
theme-specific imagery or color-only status indicators. Honor
`prefers-reduced-motion`; transitions should remain subtle and optional.
