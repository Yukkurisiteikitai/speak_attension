# attension_mindmap - Next Thread Handoff (2026-07-14)

Last updated: 2026-07-14

## Rationale: this doc supersedes NEXT_THREAD_HANDOFF.md / NEXT_THREAD_HANDOFF_2026-07-10.md

`docs/NEXT_THREAD_HANDOFF.md` (2026-07-09) and `docs/NEXT_THREAD_HANDOFF_2026-07-10.md` describe a
product direction centered on **抜け漏れ検知**(meeting gap detection). That direction explicitly
listed "グラフレイアウト改良"(layout improvements) and "放射状レイアウト"(radial layout) under
「捨てるもの」(things to abandon).

Later on 2026-07-09, the product pivoted again — this time to **アイデア出し(brainstorming)
support** as the primary mode. `src/App.tsx` now opens in アイデア出しモード by default (meeting mode
stays available via the mode switch, but is secondary). See root `HANDOFF.md` for the current
one-paragraph summary; this file is the detailed handoff for idea mode.

**Important clarification**: the "abandon radial layout" decision from the meeting-mode era does
**not** apply to idea mode. Idea mode's core UX is a radially-expanding capture-phase map that
converges into a two-sided mindmap on grouping — this is the intended design, not legacy debt. The
two older docs are kept as-is (historical decision record for the meeting-mode work); they are not
being retroactively edited.

## Idea Mode: Current State (as of 2026-07-14)

Flow: capture keywords from speech/manual text in real time → keywords appear radially around a
center node in conversation order (inner = earlier) → 出し終わった triggers grouping (local LLM via
LM Studio, rule-based fallback) with an animated radial→mindmap transition → user clicks keywords
to pick which to adopt → export Markdown and a session JSON that keeps keyword→utterance links for
RAG reuse.

Core files:

- `src/utils/ideaSession.ts` — session state, phases (`capture` / `grouping` / `select`), Markdown/JSON export
- `src/utils/ideaExtraction.ts` — keyword extraction from utterances
- `src/utils/ideaGrouping.ts` — rule-based clustering + LLM grouping prompt/parse (LM Studio)
- `src/utils/ideaLayout.ts` — node layout for both phases (see below)
- `src/hooks/ideaSessionStore.ts` / `src/hooks/useIdeaSession.ts` — store and hook
- `src/components/IdeaModeView.tsx` — UI (map, controls, keyword list, export)

## This Session (2026-07-14): Mind Map Overlap Fix

**Problem**: idea map nodes (`.idea-node` in `src/styles.css`) auto-size to their label text with
no fixed width, but the old `ideaLayout.ts` positioned them using fixed spacing constants that
ignored actual node size — long Japanese labels or high mention-count badges routinely overlapped
neighboring nodes in both phases.

**Fix** (`src/utils/ideaLayout.ts`, rewritten):

1. `estimateIdeaNodeSize(label, kind, opts)` — conservative (over-)estimate of a node's rendered
   box from its label text, mirroring the `.idea-node` CSS box model (font size / padding / border
   per kind, full-width vs half-width character weighting for CJK vs Latin). Keyword nodes always
   reserve width for the 「採用」pick-mark badge, even when unpicked, so toggling a pick never
   shifts the layout.
2. `mindmapPositions(groups, keywords, centerLabel)` (grouping/select phase) — a tidy-tree row
   stacker per side: keyword rows stack by real height, group blocks size to the taller of the
   group node or its keyword stack, and column x-offsets are derived from the center node's and
   groups' actual widths (not fixed pixel constants). Left-side nodes are anchored from their right
   edge so React Flow's top-left positioning doesn't let long left-side labels drift toward center.
   Any keyword left ungrouped (defensive — e.g. if the LLM path drops one) lands in a virtual
   「その他」column instead of collapsing to the origin.
3. `radialPositions(keywords, centerLabel)` (capture phase) — walks outward node by node; each
   candidate position is checked against every already-placed rectangle (including the center node)
   and nudged forward (angle, then radius) until clear before committing. A pure closed-form
   angle/radius formula was tried first (advance angle by the node's own footprint, jump to a new
   "ring" on wraparound) but proved insufficient: the y-axis squash (`0.72`, kept for the flattened
   visual aspect) means two points on concentric squashed ellipses at unrelated angles can sit much
   closer together than a same-angle radial-gap estimate assumes, so ring-seam and cross-ring
   overlaps slipped through. The collision-checked walk is what actually guarantees no overlap.

**Tests**: `src/utils/ideaLayout.test.ts` (new, 11 tests) — non-overlap invariants for both phases
(including long-label and multi-ring stress cases), per-side anchoring relative to the center node,
determinism, and the ungrouped-keyword fallback.

**Manual verification**: headless-browser run (Playwright) against `npm run dev:client` — added 15
mixed short/long Japanese keywords via the manual textarea, confirmed zero overlapping boxes in the
capture-phase spiral, triggered grouping, confirmed zero overlapping boxes in the resulting
two-sided mindmap, and confirmed clicking a keyword to pick it does not move any node (only the
picked node's own box grows slightly to show the 採用 badge, within the space already reserved for
it).

## Validation (2026-07-14)

- `npm run typecheck`: passed
- `npm test`: passed, 13 files / 63 tests
- `npm run lint` / `npm run build`: not run this session

## Known Limitations

- `estimateIdeaNodeSize` is a heuristic text-width estimate, not a live DOM measurement — it is
  tuned to over-estimate (safe direction), so layouts may have slightly more whitespace than the
  tightest possible packing, but should never under-estimate into an overlap.
- The radial spiral's collision-avoidance walk is O(placed nodes) per candidate check; fine at
  brainstorm-session scale (tens of keywords), would need spatial indexing if idea mode ever needs
  to support hundreds of keywords in one session.
- `docs/NEXT_THREAD_HANDOFF.md` and `docs/NEXT_THREAD_HANDOFF_2026-07-10.md` are historical and
  describe the meeting-mode-only period; don't use them as the current product description.

## Recommended Next Work

1. If idea mode keyword counts grow much larger in practice, revisit the spiral's collision check
   for performance (spatial grid bucketing would cut it from O(n) to ~O(1) per candidate).
2. No known open bugs in the layout; next idea-mode work is product-direction dependent (ask the
   user what's next for アイデア出しモード before assuming meeting-mode gap-detection work resumes).

## Session Log

- **2026-07-09**: 抜け漏れレポート・LLM判定層・納得率フィードバック実装(meeting mode).
- **2026-07-09 (later)**: pivot to アイデア出しモード as default; first idea-mode implementation lands.
- **2026-07-10**: meeting-mode UI cleanup (hide unproven realtime gap badges).
- **2026-07-14**: idea map overlap fix (`ideaLayout.ts` rewrite + tests), this doc created.
