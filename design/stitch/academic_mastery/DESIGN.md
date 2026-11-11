---
name: Academic Mastery
colors:
  surface: '#f8f9ff'
  surface-dim: '#c7dbfd'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff3ff'
  surface-container: '#e6eeff'
  surface-container-high: '#dde9ff'
  surface-container-highest: '#d4e3ff'
  on-surface: '#051c36'
  on-surface-variant: '#43474e'
  inverse-surface: '#1d314c'
  inverse-on-surface: '#ebf1ff'
  outline: '#74777f'
  outline-variant: '#c4c6cf'
  surface-tint: '#435f89'
  primary: '#002043'
  on-primary: '#ffffff'
  primary-container: '#17365d'
  on-primary-container: '#84a0cd'
  inverse-primary: '#acc8f7'
  secondary: '#006a6a'
  on-secondary: '#ffffff'
  secondary-container: '#7ff5f4'
  on-secondary-container: '#007070'
  tertiary: '#002525'
  on-tertiary: '#ffffff'
  tertiary-container: '#003c3c'
  on-tertiary-container: '#00b0b0'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d5e3ff'
  primary-fixed-dim: '#acc8f7'
  on-primary-fixed: '#001c3b'
  on-primary-fixed-variant: '#2b486f'
  secondary-fixed: '#7ff5f4'
  secondary-fixed-dim: '#60d8d8'
  on-secondary-fixed: '#002020'
  on-secondary-fixed-variant: '#004f50'
  tertiary-fixed: '#69f7f7'
  tertiary-fixed-dim: '#45dada'
  on-tertiary-fixed: '#002020'
  on-tertiary-fixed-variant: '#004f50'
  background: '#f8f9ff'
  on-background: '#051c36'
  surface-variant: '#d4e3ff'
typography:
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 36px
    fontWeight: '800'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '800'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.015em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: '700'
    lineHeight: 28px
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  label-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.04em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-mobile: 0.75rem
  margin: 2rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
---

## Brand & Style
The design system embodies an authoritative, highly focused, and rigorous academic self-study platform tailored for candidates aspiring to achieve IELTS Band 6.5–7.0. It bridges pedagogical discipline with contemporary SaaS clarity. The aesthetic balances institutional prestige (evoking university examinations and Cambridge test papers) with intelligent, responsive modern software.

The visual direction follows **Modern Academic Functionalism**—a disciplined evolution of Modern SaaS that leverages clean data structures, high legibility, purposeful content hierarchy, and deliberate structural divisions. The platform avoids distracting gamification, instead cultivating a calm, deeply focused study sanctuary that minimizes cognitive fatigue during rigorous 60-minute mock test blocks.

## Colors
The color palette establishes an intellectual hierarchy using deep maritime navies, energetic technical teals, and clinical paper neutrals:

- **Primary (`#17365D`) & Brand Depth (`#0D233D`):** Anchors the interface in formal academia. Used for primary interactive actions, high-level navigation, structural sidebars, and critical typographic anchors.
- **Secondary (`#18A6A6`) & Tertiary Accent (`#20C5C5`):** Delivers precise focus. Reserved for goal-oriented interactive states, high-value conversion elements, active skill tab indicators, and Band Score benchmark markers (e.g., target tracking for 6.5–7.0).
- **Backgrounds & Canvas Surfaces:** Light Grey (`#F5F7FA`) provides a glare-reducing backdrop for reading test passages, while Pure White (`#FFFFFF`) isolates cards and workbenches. Structural borders utilize soft slate tones (`#EAEEF4` to `#E2E8F0`).
- **Pedagogical Status Palette:**
  - **Success (`#10B981`):** Correct answers, band milestone attained, grammatical accuracy.
  - **Error (`#EF4444`):** Incorrect answers, vocabulary overuse, severe grammatical errors.
  - **Warning (`#F59E0B`):** Review required, borderline lexical choices, partial answer accuracy.
  - **Informational (`#3B82F6`):** Examiner hints, band descriptor criteria notes, structural rubrics.

## Typography
Plus Jakarta Sans provides high vertical proportions, crisp geometry, and distinct character apertures suited for prolonged Reading section practice and side-by-side analytical copy.

### Multilingual Hierarchy & Analytical Scannability
- **Academic Source Material (English):** Exam passages, listening transcripts, and model essays use standard weights (`400`, `600`) with generous reading line heights (`1.625` to `1.65`) for prolonged focus.
- **Pedagogical Annotations (Vietnamese):** AI analyses, examiner tips, and grammatical explanations appear with a tint shift to neutral dark gray (`#334155`) or inside designated container blocks to prevent visual collisions with Cambridge prompt content.
- **Tabular & Numeric Scores:** Band scores, word counters, and timer displays utilize proportional figure alignment with strict tabular spacing to avoid layout shifts.

## Layout & Spacing
The layout uses a structured, screen-filling workspace configuration designed for desktop productivity, with responsive degradation for mobile drills:

- **Desktop Framework (1280px+):** Fixed 260px left sidebar in deep navy (`#0D233D`), a persistent 64px utility header containing user metrics and Band 6.5–7.0 target milestones, and a dual-pane or single-canvas central stage utilizing a 12-column responsive fluid grid.
- **Split-Screen Exam Mode (1024px+):** Dedicated side-by-side 6-column panes for the Reading and Writing test benches. Passages lock independently to the left pane, while question items or the essay drafting editor occupy the right pane.
- **Breakpoints:**
  - `Desktop (>= 1280px)`: 24px margins, 24px gutters, persistent full sidebar.
  - `Tablet (768px - 1279px)`: 16px margins, 16px gutters, collapsed icon-only sidebar (72px), single-column stacked reading mode.
  - `Mobile (< 768px)`: 16px outer margin, 12px gutters, bottom navigation bar replacing the sidebar, focused single-card task flows.

## Elevation & Depth
Elevation emphasizes planar restraint, prioritizing clean edge delineation over dramatic shadows to maintain an academic document feel.

- **Base Canvas:** The light gray foundation (`#F5F7FA`) acts as elevation level 0.
- **Surface Elevation (Cards & Panels):** Pure White (`#FFFFFF`) surfaces sit at level 1, bound by a crisp 1px border (`#EAEEF4`) complemented by an ambient feather shadow: `0 1px 3px 0 rgba(13, 35, 61, 0.04), 0 1px 2px -1px rgba(13, 35, 61, 0.04)`.
- **Interactive Hover & Drag Elevation:** Elevates slightly with `0 4px 6px -1px rgba(13, 35, 61, 0.07), 0 2px 4px -2px rgba(13, 35, 61, 0.05)` and subtle teal border highlighting (`#18A6A6`).
- **Overlays, Popovers, & Band Comparison Drawers:** Floating inspection modals and AI critique popovers use `0 10px 15px -3px rgba(13, 35, 61, 0.1), 0 4px 6px -4px rgba(13, 35, 61, 0.06)` combined with a soft scrim backdrop blur (`backdrop-blur-sm`, `rgba(13, 35, 61, 0.4)`).

## Shapes
A unified radius scale establishes modern, approachable interfaces without sacrificing geometric authority:

- **Standard Inputs, Badges, & Buttons:** 8px (`rounded-md` / base roundedness token) ensures tight, predictable hit targets and alignment.
- **Cards, Test Viewports, & Workbench Enclosures:** 12px (`rounded-xl`) delivers clean framing for test questions and multi-paragraph prompts.
- **Band Indicators & Status Badges:** Fully rounded pills (`rounded-full`) differentiate status tokens and score pills from rectangular structural containers.

## Components

### Buttons & Interactive Controls
- **Primary CTA:** Deep Navy (`#17365D`) background, `#FFFFFF` text, `font-weight: 600`, 8px border radius. Hover transitions to `#0D233D`.
- **Accent Action (Submit Exam / Claim Score):** Vivid Teal (`#18A6A6`) background, white text. Hover transitions to `#20C5C5`.
- **Secondary / Ghost:** Transparent background, 1px border (`#E2E8F0`), text in `#17365D`. Hover fills with `#F8FAFC`.

### Skill Navigation Tabs (Listening, Reading, Writing, Speaking)
- Segmented container style with `#F1F5F9` background track.
- Active skill pill receives Pure White fill, crisp `shadow-sm`, and an accent indicator highlight in Vivid Teal (`#18A6A6`) with bold text weight.
- Skill icon accompanies each tab for quick cross-module identification.

### Dual-Tone Progress Tracker
- Base track in light slate (`#E2E8F0`) with 6px height and fully rounded corners.
- Primary bar displays completed baseline progression in Navy (`#17365D`), with target projection bands (e.g., gap toward Band 7.0) displayed in vivid Teal (`#20C5C5`).

### Band Score Badges
- **Target Achieved / High Band (7.0+):** Pill badge with soft teal surface (`#E6F7F7`), deep teal text (`#0E6565`), and a 1px border (`#B2E7E7`).
- **In-Progress Band (6.0 - 6.5):** Soft navy tint surface (`#EDF2F8`), deep navy text (`#17365D`), and a 1px border (`#CBD8E6`).
- **Needs Attention (< 6.0):** Soft amber surface (`#FEF3C7`), dark amber text (`#B45309`).

### Error Categorization Tags
- Compact 20px-tall semantic tags denoting error classes:
  - *Grammar & Accuracy:* Soft Red background (`#FEE2E2`), Red text (`#DC2626`).
  - *Lexical Resource:* Soft Amber background (`#FEF3C7`), Dark Amber text (`#B45309`).
  - *Coherence & Cohesion:* Soft Blue background (`#DBEAFE`), Navy text (`#1D4ED8`).

### AI Model Evaluator Comparator (Claude vs. ChatGPT)
- Symmetrical two-column grid card system with dedicated model headers:
  - Claude header branded with an earthy plum or indigo accent badge.
  - ChatGPT header branded with an academic emerald-teal badge.
- Inline differential highlighting: Green wash (`#ECFDF5`) for vocabulary enhancements and strikethroughs with red wash (`#FEF2F2`) for syntax corrections.
- Expandable accordion rows for Band Descriptors: Task Achievement, Coherence & Cohesion, Lexical Resource, Grammatical Range & Accuracy.

### Form Inputs & Writing Textareas
- Surface: `#FFFFFF`, 1px solid border (`#E2E8F0`), 8px border radius.
- Focus: 1px solid `#18A6A6` accompanied by an ambient teal focus ring (`box-shadow: 0 0 0 3px rgba(24, 166, 166, 0.15)`).
- Timed essay editor features a sticky bottom meta bar showing real-time word count, paragraph index, and an automated Band 7 minimum threshold indicator (e.g., "250 / 250 words reached").