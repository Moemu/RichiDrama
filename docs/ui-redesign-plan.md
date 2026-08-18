# UI Refactor Plan

Reference: `https://xc.agent.richbest.cn/` (visual and interaction inspiration only; no source, assets, copy, or brand material is reused).

## Reference observations

- Dark immersive canvas with small luminous green/purple accents.
- Compact top navigation and a clear central starting action.
- Rounded, low-contrast grouped controls; media and creation results lead the page.
- Mobile keeps hierarchy through horizontal navigation and stacked sections rather than shrinking desktop columns.

## Protected scope

Do not change API contracts, backend code, routes, authentication/authorization, storage, Pinia state, request behavior, or workflow semantics.

## Delivery order

1. **Application shell and tokens** — verify `theme.css`, top-level canvas, typography, and theme parity.
2. **Shared primitives** — unify existing Element Plus button/input/table/dialog use through tokens; no new UI framework.
3. **Primary creative entry** — refactor one bounded page at a time, beginning with the project list or creative entry surface.
4. **Workspaces** — proceed through creation, media, and operations areas separately.
5. **Visual QA** — compare at 1440×900, 1024×768, and 390×844; inspect console/network and overflow.

## Fidelity ledger

| Area | Reference intent | Current decision | Status |
| --- | --- | --- | --- |
| Global canvas | Dark, calm, luminous | Existing dark-first token system retained | Close |
| Navigation | Compact grouped controls | Preserve routes; address shell per page | Pending |
| Primary creation entry | One obvious prompt/action | First bounded page to refactor | Pending |
| Media cards | Media-led rounded cards | Reuse existing media components | Pending |
| Mobile | Stacked, touch-friendly hierarchy | Validate each touched page at 390px | Pending |
