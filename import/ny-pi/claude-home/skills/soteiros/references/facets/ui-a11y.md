# Facet: UI and accessibility

## Editions seen 2026-10-30 (re-resolve)
| Item | Edition | Source |
| --- | --- | --- |
| WCAG | 2.2, W3C Recommendation (edition 2024-12-12); ISO/IEC 40500:2025 is the October 2023 text | w3.org/TR/WCAG22/; w3.org/WAI/standards-guidelines/wcag/ |
| WCAG 3.0 | Working Draft (2026-09-10): note only, never a target | w3.org/TR/wcag-3.0/ |
| EU (EAA) | The legal reference stays EN 301 549 v3.2.1 (WCAG 2.1 AA) until the Official Journal cites v4.1.1 (WCAG 2.2; published 2026-09-02, not cited as of 2026-11-10, citation expected late November to mid-December 2026). Target WCAG 2.2 AA anyway | accessible-eu-centre.ec.europa.eu |
| Web platform | Use Baseline "Widely available" features freely (30 months after interop); feature-detect "Newly available" ones | web.dev/baseline |

## Checks (cite the WCAG 2.2 success criterion)
- Semantics: a `<button>` or `<a href>` for controls, never a `div` or `span` with `onclick` (2.1.1 Keyboard,
  4.1.2 Name, Role, Value). Landmarks and a heading order. `lang` on `<html>`.
- Forms: a programmatic `<label>` for every input, errors linked with `aria-describedby`, no
  placeholder-only labels (1.3.1, 3.3.2).
- Keyboard: visible focus not obscured (2.4.7, 2.4.11); no keyboard traps; target size at least 24x24 CSS px
  (2.5.8).
- Media: `alt` for meaningful images, captions for video; contrast at least 4.5:1 for text and 3:1 for UI
  components (1.4.3, 1.4.11).
- Motion: animations use `transform`/`opacity`, not layout properties (`left`, `top`, `width`). Non-essential
  motion is disabled under `@media (prefers-reduced-motion: reduce)` (2.3.3).
- Modern CSS and HTML where Baseline allows it: container queries, `:has()`, native `<dialog>` and `popover`,
  logical properties.

## Tools
axe-core or Lighthouse accessibility through the `mcp__playwright__*` tools (`tool_search` first); a manual keyboard pass; contrast checks.

## Severity
- High: controls unreachable by keyboard; inputs without labels; motion that cannot be disabled on large
  movements.
- Medium: low contrast; small targets; layout-property animations.

Depth: `accessibility-audit`, `web-ui-craft`, `design-review`, `ux-reviewer`.
