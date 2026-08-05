# Stationery refresh: blue text, grid paper, new logo

Three visual-only changes. Layout, spacing, animations, and behaviour stay untouched.

## 1. Text colour → #1B1AB5

Update the foreground tokens in `src/styles.css` so every heading, paragraph, label, card text, and button label inherits the new blue:

- `--foreground`, `--card-foreground`, `--popover-foreground`, `--secondary-foreground`, `--accent-foreground`, `--primary-foreground` → `#1B1AB5` (as oklch)
- `--muted-foreground` → same hue at reduced opacity so secondary text stays visually lighter without changing hierarchy

Button fills, borders, shadows, and the pastel yellow palette stay exactly as they are — only label colour shifts.

## 2. Grid paper background

Add a page-wide overlay in `src/styles.css`:

- Two repeating linear-gradients (vertical + horizontal), thin light-grey lines, ~64px square spacing, low opacity
- Applied on the `body` (or a fixed pseudo-element behind content) so it covers every section consistently and sits above the cream background but beneath all content
- `--gradient-hero` and cream/ivory tones remain visible underneath; no change to the botanical illustrations

## 3. Logo swap

Replace the header logo with the uploaded Bonji wordmark, registered as a Lovable asset and imported in `src/routes/index.tsx`. Same position, alignment, and `h-9 w-auto` sizing. Also regenerate `public/favicon.png` from the new logo.

## Technical notes

- All colour work happens in `src/styles.css` tokens — no per-component hardcoded colours.
- Grid uses `@utility`/base-layer CSS so it applies globally without touching component markup.
- One line changes in `src/routes/index.tsx`: the logo import.
