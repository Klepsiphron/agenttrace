# AgentTrace UI Overhaul -- Complete Redesign

## Goal

Modernize every customer-facing UI component in AgentTrace to look like a polished, production SaaS product. Think: Vercel dashboard meets Linear meets Stripe's documentation site.

## Design System

### Colors

- Background: `#0a0a0c` (near-black, not dark gray)
- Surface: `#111113` (cards, panels)
- Surface elevated: `#16161a` (hovered cards, dropdowns)
- Border: `#242429` (subtle, not heavy)
- Text primary: `#e8e8eb`
- Text muted: `#9a9aa0`
- Accent: `#3b82f6` (blue)
- Accent hover: `#60a5fa`
- Success: `#22c55e`
- Warning: `#eab308`
- Error: `#ef4444`

### Typography

- System font stack (no Google Fonts -- fast, local)
- Monospace: `ui-monospace, SFMono-Regular, Menlo, monospace`
- Base size: 14px, line-height 1.6
- Headings: system-ui, tight letter-spacing (-0.2px to -0.5px)

### Spacing

- 4px base unit
- Cards: 16-20px padding
- Sections: 24-32px margin-bottom
- Tight groupings: 8-12px

### Components

- Cards: `border-radius: 8px`, subtle border, no shadows
- Buttons: `border-radius: 6px`, minimal padding (7px 12px)
- Badges: `border-radius: 999px`, tiny font (10-11px)
- Inputs: match dark theme, no white backgrounds

## Files to Redesign (in priority order)

### 1. Dashboard (packages/dashboard/public/)

The main product UI. Currently functional but basic visual design.

**Packages Dashboard Improvements:**

- [ ] Hero/stats section: larger numbers, sparkline charts for token/cost trends
- [ ] Add a "Token Burn Rate" indicator (tokens/min, cost/hour)
- [ ] Add "Top Agents" panel showing agents by token usage
- [ ] Run list: add relative time ("2m ago", "1h ago") alongside timestamps
- [ ] Run list: show a mini cost-per-run bar chart (visual indicator)
- [ ] Trace details: collapsible sections, better JSON viewer with syntax highlighting
- [ ] Add keyboard shortcuts (j/k to navigate runs, enter to expand, esc to close)
- [ ] Loading states: skeleton spinners instead of "Loading..."
- [ ] Empty states: helpful illustrations/text ("No runs yet. Wrap your first agent!")
- [ ] Toast notifications for refresh/export actions
- [ ] Search bar to filter runs by name
- [ ] Date range picker (last hour, today, week, all time)
- [ ] Responsive: works on mobile (currently breaks below 640px)
- [ ] Fix version display: should read actual version (0.1.0) not "v0.0.0"

**Usage Page Improvements:**

- [ ] Live indicator animation (pulsing green dot)
- [ ] Add cost projection chart (spend rate → projected daily/monthly)
- [ ] Add per-agent breakdown table
- [ ] Add "Top Tools" section showing most-called tools
- [ ] Responsive layout

### 2. Landing Page (website/index.html)

Currently a single long page. Needs to convert visitors.

**Landing Page Improvements:**

- [ ] Hero: add a screenshot/mockup of the dashboard in action
- [ ] Hero: add social proof ("Used by X developers", GitHub stars badge)
- [ ] Add a "How It Works" section (3 steps: install, wrap, view)
- [ ] Add interactive terminal demo (animated typing showing CLI usage)
- [ ] Feature cards: add icons for each feature
- [ ] Add testimonials/social proof section
- [ ] Comparison table: vs Langfuse, LangSmith, AgentOps (honest, concise)
- [ ] Add FAQ section (collapsible)
- [ ] Add a clear CTA button ("Get Started" → links to quickstart)
- [ ] Footer: proper links (GitHub, npm, PyPI, docs, license)
- [ ] Mobile: verify all sections stack correctly
- [ ] Add OpenGraph meta tags for social sharing
- [ ] Add `rel="noopener"` on all external links

### 3. Quickstart Docs (website/docs/quickstart.md)

**Improvements:**

- [ ] Add copy-to-clipboard buttons on all code blocks
- [ ] Add "Next Steps" section at the bottom
- [ ] Link to relevant examples
- [ ] Add troubleshooting tips for common install issues

### 4. API Reference (website/docs/api.md)

**Improvements:**

- [ ] Add a sticky sidebar TOC for navigation
- [ ] Add per-section anchor links
- [ ] Code examples for every method
- [ ] Add type signatures for TypeScript
- [ ] Add Python equivalent for every TS example

### 5. Enterprise Page (website/docs/enterprise.md)

**Improvements:**

- [ ] Add comparison table (Free vs Pro vs Enterprise)
- [ ] Add "Contact Sales" CTA
- [ ] Add ROI calculator section ("How much are you spending on AI tokens?")
- [ ] Add compliance badges (SOC 2, GDPR, HIPAA-ready)

### 6. Error pages

**Create:**

- `packages/dashboard/public/404.html` -- branded 404 page
- `packages/dashboard/public/error.html` -- generic error with retry

### 7. Favicon and branding

**Create:**

- `packages/dashboard/public/favicon.svg` -- simple geometric logo
- `packages/dashboard/public/apple-touch-icon.png`
- `website/favicon.svg`

### 8. CLI output improvements

**File: packages/cli/src/index.ts**

- [ ] `runs` command: show sparkline bars for cost per run
- [ ] `stats` command: add trend indicators (↑ 12% from last week)
- [ ] `self-stats` command: add bar chart in terminal (using ASCII blocks)
- [ ] All tables: right-align numbers, use thousands separators
- [ ] Add `--no-color` flag support for CI environments

## Implementation Notes

- Build ALL HTML/CSS/JS from scratch -- no frameworks, no external dependencies
- Use CSS custom properties for the design system (defined above)
- Use vanilla JS -- no React, no Vue, no jQuery
- All images/icons: use inline SVG or CSS-only (no external image dependencies)
- Responsive: mobile-first, works at 320px width
- Accessibility: proper ARIA labels, keyboard navigation, focus indicators
- Performance: lazy-load trace details, virtualize long run lists (100+ items)
- Browser support: Chrome, Firefox, Safari, Edge (last 2 versions)

## After Implementation

1. Build: `pnpm build`
2. Test: `pnpm test` (all must pass)
3. Visual verification:
   - Dashboard loads at http://127.0.0.1:4317
   - Landing page looks professional
   - All pages responsive at 320px, 768px, 1200px
4. Commit and push to origin/main
