# UI/UX Design System Audit Report

**Project:** Nest Personal Finance App  
**Date:** 2026-05-02  
**Auditor:** Claude (Frontend Engineer & Design Systems Specialist)

---

## Executive Summary

This audit analyzed the Nest application's CSS architecture (~8,439 lines, ~966 class definitions) and implemented a comprehensive design system normalization. The app uses a pure CSS approach with Tailwind CSS, global stylesheets, and extensive CSS custom properties.

### Key Findings

| Category | Status | Notes |
|----------|--------|-------|
| CSS Architecture | ✅ Good | Single globals.css, semantic class names, CSS custom properties |
| Design Tokens | ⚠️ Partial | Existing tokens present but incomplete spacing, typography, animation scales |
| Dark Mode | ⚠️ Partial | 4 media queries found, coverage incomplete |
| Component Consistency | ❌ Needs Work | Multiple modal patterns, inconsistent z-index values |
| Accessibility | ✅ Good | Focus-visible states present, reduced-motion support |

---

## Phase 1: Architecture Audit Results

### 1.1 CSS File Structure

| File | Role | Lines | Classes |
|------|------|-------|---------|
| `app/globals.css` | Global styles + components | ~8,500 | ~966 |
| `tailwind.config.js` | Tailwind customization | 30 | N/A |

**No CSS Modules detected** — the project uses a pure global CSS approach.

### 1.2 Existing Token Categories

**Well-Defined ✅**
- Brand colors (--brand-50 to --brand-800)
- Accent colors (--teal, --peach, --lime)
- Backgrounds (--bg-base, --bg-surface, --bg-elevated, --bg-subtle)
- Text colors (--text-primary, --text-secondary, --text-tertiary, --text-disabled)
- Border colors (--border-subtle, --border-default)
- Semantic colors (--success, --warning, --danger with -bg variants)
- Radius (--r-sm, --r-md, --r-lg, --r-xl, --r-pill)
- Shadows (--shadow-sm, --shadow-md, --shadow-lg)
- Transitions (--t: 170ms cubic-bezier)
- Fonts (--font-display, --font-body, --font-mono)

**Missing/Inconsistent ❌**
- No spacing scale (--space-*)
- No typography scale (--text-xs to --text-3xl)
- No z-index tokens (--z-*)
- No animation duration/easing tokens
- No component-specific tokens (button heights, input padding, etc.)

### 1.3 Component Inconsistency Audit

#### Buttons
**Issues Found:**
- Size variants: btn-xs, btn-sm, btn-icon (hardcoded values)
- Variants: btn-primary, btn-secondary, btn-ghost, btn-danger (inconsistent naming)
- Focus ring uses hardcoded --brand-500 instead of semantic token
- No loading state spinner defined as reusable pattern
- Mix of transition durations (0.15s, var(--t), 200ms)

#### Modals
**Issues Found:**
- Multiple modal patterns:
  - `.profile-modal` (confirm dialog, profile modal)
  - `.txn-modal` / `.recv-modal` (transaction/receivable modals)
  - `.inv-modal` (investment modals)
- Inconsistent z-index: 120, not using tokens
- Inconsistent max-width: 380px, 520px, 1100px, 460px
- Inconsistent padding and border-radius values
- Animation keyframes scattered, inconsistent easing

#### Form Inputs
**Issues Found:**
- Focus box-shadow hardcoded with rgba value
- Error states not consistently styled
- Date input calendar icons use invert filters

#### Z-Index Chaos
```
.sidebar { z-index: 10 }
.sb-user-menu { z-index: 30 }
.sidebar-overlay { z-index: 40 }
.sidebar.open { z-index: 50 }
.bank-selector-menu { z-index: 20 }
.toast-stack { z-index: 60 }
.audit-timeline { z-index: 80 }
.profile-modal-overlay { z-index: 120 }
.cc-user-menu { z-index: 200 }
.cookie-overlay { z-index: 1200 }
.collab-banner { z-index: 1150 }
.navigation-loader-spinner { z-index: 9999 }
```

---

## Phase 2: Design Token System (Implemented)

### 2.1 New Token Categories Added

```css
/* Spacing Scale (4px base) */
--space-1: 4px;   --space-2: 8px;   --space-3: 12px;
--space-4: 16px;  --space-5: 20px;  --space-6: 24px;
--space-8: 32px;  --space-10: 40px; --space-12: 48px;  --space-16: 64px;

/* Typography Scale */
--text-xs: 11px;  --text-sm: 12px;  --text-base: 13px;
--text-md: 14px;  --text-lg: 15px;  --text-xl: 16px;
--text-2xl: 18px; --text-3xl: 24px; --text-4xl: 28px;

/* Font Weights */
--font-weight-regular: 400;  --font-weight-medium: 500;
--font-weight-semibold: 600; --font-weight-bold: 700;
--font-weight-extrabold: 800;

/* Animation */
--duration-instant: 0ms;   --duration-fast: 150ms;
--duration-base: 200ms;  --duration-slow: 300ms;
--ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
--ease-decelerate: cubic-bezier(0, 0, 0.2, 1);
--ease-accelerate: cubic-bezier(0.4, 0, 1, 1);

/* Z-Index Scale */
--z-base: 0;      --z-raised: 10;    --z-dropdown: 100;
--z-sticky: 200;  --z-overlay: 300;  --z-modal: 400;
--z-toast: 500;   --z-tooltip: 600;  --z-maximum: 9999;

/* Component Tokens */
--btn-height-sm: 32px;  --btn-height-md: 36px;  --btn-height-lg: 44px;
--input-height: 36px;
--card-radius: 14px;
--modal-radius: var(--r-lg);
```

### 2.2 Dark Mode Token Overrides

Added comprehensive dark mode color mapping:
- Backgrounds inverted (light → dark)
- Text colors adjusted for contrast
- Semantic colors brightened for visibility
- Border colors darkened
- Overlay opacity increased

---

## Phase 3: Standardized Component Patterns (Implemented)

### 3.1 Button System

**Base Classes:** `.btn` with size and variant modifiers

```css
/* Sizes */
.btn-sm (32px height, r-sm radius)
.btn-md (36px height, r-md radius) — default
.btn-lg (44px height, r-md radius)
.btn-icon (square aspect ratio)

/* Variants */
.btn-primary   — Filled, primary action
.btn-secondary — Bordered, neutral
.btn-ghost     — Transparent, subtle
.btn-outline   — Bordered, no fill
.btn-destructive — Danger action

/* States */
:hover, :active, :disabled, .is-loading
:focus-visible with consistent ring
```

**Key Improvements:**
- All buttons now use CSS custom properties
- Consistent transition timing (var(--duration-fast) var(--ease-standard))
- Unified focus ring pattern
- Loading spinner state defined

### 3.2 Modal System

**Base Classes:** `.modal-overlay` → `.modal-container`

```css
/* Sizes */
.modal-sm (max-width: 400px)
.modal-md (max-width: 560px) — default
.modal-lg (max-width: 720px)
.modal-xl (max-width: 1100px)

/* Structure */
.modal-header
.modal-title
.modal-close
.modal-body (scrollable)
.modal-footer (action buttons)

/* Animation */
modal-overlay-in, modal-container-in (ease-decelerate entering)
modal-overlay-out, modal-container-out (ease-accelerate exiting)
```

**Key Improvements:**
- Unified overlay backdrop color (var(--color-overlay))
- Consistent z-index (var(--z-modal))
- Mobile-optimized bottom sheet variant
- Proper entry/exit animations with scale transform

### 3.3 Form Input System

**Base Class:** `.input` with state modifiers

```css
/* States */
.input:focus      — Primary color border + shadow
.input:disabled   — Reduced opacity
.input.is-error   — Danger border + shadow

/* Label */
.label — Consistent label styling

/* Validation */
.form-error — Error message styling
```

### 3.4 Card System

```css
/* Base */
.card — Standard card
.card-sm — Compact variant
.card-interactive — Hover lift effect
```

---

## Phase 4: Dark Mode Support

### 4.1 Implementation Strategy

- Used `prefers-color-scheme: dark` media query
- Overrode :root custom properties for colors
- No component-specific dark mode code
- Relies on semantic tokens adapting automatically

### 4.2 Dark Mode Coverage

| Element | Light | Dark |
|---------|-------|------|
| Backgrounds | #f5f2ed, #fdfcfa, #ffffff | #1a1815, #22201c, #2a2723 |
| Text | #1c1916, #4a4540 | #f5f2ed, #b8b2a8 |
| Borders | #ddd9d1, #c5bfb5 | #3a3630, #4a4540 |
| Success | #1a8f58 on #edfaf3 | #4ade80 on #14532d |
| Warning | #d97706 on #fff8ec | #fbbf24 on #713f12 |
| Danger | #dc2626 on #fef2f2 | #f87171 on #7f1d1d |

---

## Phase 5: Files Changed

| File | Changes | Reason |
|------|---------|--------|
| `app/globals.css` | +600 lines | Added design tokens, standardized component patterns, dark mode tokens |
| `components/confirm-dialog.tsx` | Updated class names | Migrated to standardized modal classes |

---

## Remaining Issues

### Requires Manual Review

1. **Modal Migration** — Other modals (txn-modal, recv-modal, inv-modal) still use legacy classes
   - Suggested: Gradual migration as components are touched

2. **Button Class Updates** — Existing buttons use hardcoded values
   - Current classes still work (backwards compatible)
   - Suggested: Update to btn-md, btn-lg when convenient

3. **Dark Mode Testing** — Needs visual review under `prefers-color-scheme: dark`
   - Suggested: Enable system dark mode and verify all components

4. **Focus Ring Consistency** — Some components may override outline incorrectly
   - Suggested: Search for `outline: none` without replacement

### No Changes Required

- All business logic preserved
- All existing class names preserved (backwards compatible)
- No breaking changes to component props

---

## Standards Established

### For New Components

1. Use design tokens exclusively
2. Follow standardized component classes
3. Implement full state matrix (default, hover, focus, active, disabled)
4. Support prefers-reduced-motion
5. Use semantic color tokens (not hardcoded values)

### For Maintenance

1. When touching old code, migrate to new patterns
2. Use --space-* for all spacing
3. Use --text-* for all font sizes
4. Use --z-* for all z-index values
5. Use --duration-* and --ease-* for all transitions

---

## Appendix: Token Reference

### Quick Reference Card

| Token Category | Usage |
|---------------|-------|
| `--space-{1,2,3,4,5,6,8,10,12,16}` | All spacing (gap, padding, margin) |
| `--text-{xs,sm,base,md,lg,xl,2xl,3xl,4xl}` | Font sizes |
| `--font-weight-{regular,medium,semibold,bold,extrabold}` | Font weights |
| `--z-{base,raised,dropdown,sticky,overlay,modal,toast,tooltip,maximum}` | Stacking order |
| `--duration-{instant,fast,base,slow}` | Animation timing |
| `--ease-{standard,decelerate,accelerate}` | Animation easing |

### Legacy Token Compatibility

All existing tokens preserved:
- `--t` (maps to var(--duration-base) var(--ease-standard))
- `--r-sm`, `--r-md`, `--r-lg`, `--r-xl`, `--r-pill`
- All brand colors (--brand-50 to --brand-800)
- All background/text/border colors preserved
