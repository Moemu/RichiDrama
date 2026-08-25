# LocalMiniDrama Design System

## Design philosophy

The product is a focused, dark-first creative workbench. Reference inspiration is limited to its compositional language: calm dark canvases, media-first surfaces, rounded grouped controls, restrained luminous accents, and a single obvious next action. Existing API, router, permissions, state, and workflow behavior remain unchanged.

## Theme tokens

`frontweb/src/styles/theme.css` is the only colour authority. Components must use its existing `--bg-*`, `--text-*`, `--border-*`, `--accent*`, and `--status-*` tokens. `html.dark` is the default; `html.light` provides the matching light palette. A page must not force either theme.

## Typography

- Family: `--font-sans` (includes PingFang SC and system fallbacks).
- Display: 28–40px, weight 650–720, tight tracking.
- H1/H2/H3: existing global scale, used in semantic order.
- Body: 17px token with 1.6–1.7 line-height.
- Labels and metadata: 12–15px, `--text-muted`; never communicate status by colour alone.

## Layout and spacing

- Content shells use fluid widths and `clamp()` padding.
- Base spacing rhythm: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- Desktop validation: 1440×900 and 1024×768. Mobile validation: 390×844.
- Tables may scroll inside a dedicated wrapper; pages must not horizontally overflow.

## Surfaces, borders, and elevation

- Page canvas: `--bg-page`; primary surface: `--bg-surface`; raised controls: `--bg-raised`/`--bg-elevated`.
- Standard borders use `--border-color`; selected and focus states use `--accent`/`--focus-ring`.
- Radius follows the existing `--radius-sm` through `--radius-xl` scale. Avoid page-specific radius systems.
- Dark surfaces may use one subtle inset highlight and `--shadow-sm`/`--shadow-md`; do not stack decorative shadows.

## Components and interaction

- Use Element Plus for controls, dialogs, drawers, tables, pagination, and form semantics.
- One primary action per section. Secondary actions use the normal or text button treatment.
- Hover and keyboard focus share a state; focus remains visibly outlined.
- Loading uses `aria-busy` or the component's native loading state. Empty and error states must be textual.

## Responsive behavior

- Navigation may become horizontally scrollable segmented controls on narrow screens.
- Grids collapse by available content width; touch targets remain at least 44px where practical.
- Respect `prefers-reduced-motion` and `prefers-contrast`.
