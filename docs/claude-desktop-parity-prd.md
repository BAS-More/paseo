# PRD: Claude Desktop App Parity for Paseo

**Version:** 1.0
**Date:** 2026-05-10
**Target:** Paseo (`C:\Dev\tools\paseo`) — Expo/React Native/unistyles
**Goal:** Make Paseo look, feel, and function like the Claude Desktop App in every observable detail.

---

## 1. Executive Summary

Paseo is a multi-provider coding agent GUI built on Expo + React Native + unistyles. It already has a rich feature set (agent panels, file explorer, terminal, sidebar, workspace tabs, voice, keyboard shortcuts, 6 dark themes + light theme, 8 provider integrations). However, it currently looks like a _developer tool IDE_ — not like the elegant, warm Claude Desktop App.

This PRD specifies every visual, behavioral, and functional change needed to achieve Claude Desktop App parity as a selectable "Claude Desktop" mode within Paseo. The existing multi-provider/workspace architecture stays intact; this is a **theming + layout + polish** effort, not a rewrite.

---

## 2. Current State (Audit Summary)

### What Paseo Has (Keep)

- **6 themes** (light, dark/paseo, zinc, midnight, claude, ghostty) — well-structured `buildDarkSemanticColors()` builder
- **Semantic token system** — `surface0-4`, `foreground`, `foregroundMuted`, `accent`, `border`, `borderAccent` — clean and extensible
- **Spacing/typography/radius scales** — `SPACING`, `FONT_SIZE`, `BORDER_RADIUS` — consistent 4px grid
- **5 breakpoints** (xs/sm/md/lg/xl) — responsive from mobile to desktop
- **Sidebar** — project-grouped agent list with workspace sections, resize handle, collapsible
- **Agent panel** — stream view (messages, tool calls, permissions, thoughts, compactions) + composer
- **Composer** — rich input with attachments, autocomplete, voice dictation, model/mode selector, status bar
- **8 providers** — claude, codex, copilot, opencode, pi, occ, crewai, gemini (with modes per provider)
- **Message rendering** — user messages, assistant messages with markdown, tool calls (collapsible), activity logs, plan cards, todo cards, compaction markers
- **Settings** — theme picker, host management, keyboard shortcuts, provider config, project settings
- **Keyboard shortcuts** — full system with customizable bindings, dispatcher, action handler
- **File explorer** — tree view with diff support, git integration
- **Terminal** — xterm.js integration
- **Desktop features** — Electron runtime, titlebar drag region, window controls, permissions, updates

### What Paseo Lacks vs Claude Desktop

1. **Warm beige/cream palette** — Claude Desktop uses `#FAF9F5` background, warm neutrals. Paseo's `darkClaude` theme uses `#1f1f1e` (dark warm) but no light-warm equivalent.
2. **Centered single-column chat** — Claude Desktop has a clean centered column (~680px). Paseo's `MAX_CONTENT_WIDTH = 820` is close but the overall layout is IDE-like with multi-pane splits.
3. **User message bubbles** — Claude Desktop has rounded bubble containers for user messages. Paseo renders user messages inline.
4. **Claude sparkle icon** — Claude Desktop uses the sparkle/star avatar next to Claude responses. Paseo uses provider-generic icons.
5. **Date-grouped sidebar** — Claude Desktop groups chats by "Today", "Yesterday", "Previous 7 Days", "Previous 30 Days". Paseo groups by workspace/project.
6. **Floating composer** — Claude Desktop has a bottom-floating rounded input with subtle shadow. Paseo's composer is docked.
7. **Empty state** — Claude Desktop shows "How can I help you today?" with suggested prompts. Paseo shows a "New Agent" draft tab.
8. **Thinking blocks** — Claude Desktop shows collapsible "Thinking..." with duration label. Paseo has thought rendering but may differ in style.
9. **Model selector pill** — Claude Desktop has a subtle model selector at bottom-left of composer. Paseo has `CombinedModelSelector`.
10. **Hover actions on messages** — Claude Desktop shows copy/edit actions on hover. Paseo has `TurnCopyButton`.
11. **Settings as modal/sheet** — Claude Desktop opens settings as an overlay modal. Paseo navigates to a separate screen.
12. **Conversation rename** — Claude Desktop allows inline rename of conversations in sidebar. Paseo titles come from agent metadata.
13. **Artifact/canvas view** — Claude Desktop has a side panel for artifacts/previews. Paseo has file-panel and browser-panel but no dedicated artifact pane.
14. **New chat shortcut** — Claude Desktop: Cmd+N creates new conversation. Paseo: Cmd+N creates new agent tab.
15. **Search conversations** — Claude Desktop has a search bar in sidebar. Paseo has workspace filtering but not conversation search.

---

## 3. Requirements

### 3.1 Design System — "Claude Warm" Theme Variant

**EARS: When** the user selects the "Claude Desktop" theme in settings, **the system shall** apply a warm beige/cream color palette matching the Claude Desktop App:

| Token             | Light Value | Dark Value                        | Source              |
| ----------------- | ----------- | --------------------------------- | ------------------- |
| `surface0`        | `#FAF9F5`   | `#1f1f1e` (existing `darkClaude`) | App background      |
| `surface1`        | `#F5F4EF`   | `#262523`                         | Subtle hover        |
| `surface2`        | `#EDECE7`   | `#2f2d2b`                         | Inputs, badges      |
| `surface3`        | `#E3E2DD`   | `#4a4745`                         | Elevated            |
| `surfaceSidebar`  | `#F0EFE9`   | `#1a1918`                         | Sidebar bg          |
| `foreground`      | `#1a1a1e`   | `#fafafa`                         | Primary text        |
| `foregroundMuted` | `#6b6560`   | `#ada9a5`                         | Secondary text      |
| `accent`          | `#D97757`   | `#D97757`                         | Claude orange       |
| `accentBright`    | `#E89A7F`   | `#E89A7F`                         | Hover accent        |
| `border`          | `#E8E6E0`   | `#2c2a27`                         | Dividers            |
| `userBubble`      | `#F0EFE9`   | `#2f2d2b`                         | User msg background |

**AC-1:** Light-warm theme renders with cream `#FAF9F5` background, not pure white.
**AC-2:** Dark-warm variant reuses existing `darkClaude` colors.
**AC-3:** All existing semantic tokens (`accent`, `destructive`, `success`) map correctly in both variants.

### 3.2 Layout — Centered Chat Column

**EARS: When** the "Claude Desktop" layout mode is active, **the system shall** render:

- Sidebar on left (collapsible, 260px default, existing resize behavior)
- Centered chat column (max-width 680px) in main area
- No file-panel/terminal/browser-panel splits visible (hidden, not removed — still accessible via shortcuts)

**AC-4:** Chat column centered horizontally in the available width after sidebar.
**AC-5:** `MAX_CONTENT_WIDTH` reduced from 820 to 680 in Claude Desktop mode.
**AC-6:** Multi-pane splits hidden by default; can be toggled back via keyboard shortcut or menu.

### 3.3 Messages — User Bubbles + Claude Avatar

**EARS: When** rendering a user message, **the system shall** wrap it in a rounded bubble with `userBubble` background and `borderRadius.xl` (12px).

**EARS: When** rendering an assistant message from the `claude` provider, **the system shall** display the Claude sparkle icon (existing `ClaudeIcon`) as an avatar in the left gutter.

**AC-7:** User messages have visible rounded bubble container.
**AC-8:** Claude responses show sparkle icon avatar at top-left of message block.
**AC-9:** Non-Claude provider messages use existing `getProviderIcon()` for avatar.
**AC-10:** Avatar column width: 28px. Message content starts after avatar + 12px gap.

### 3.4 Composer — Floating Rounded Input

**EARS: When** the Claude Desktop layout is active, **the system shall** render the composer as a floating pill at the bottom of the chat area:

- Rounded corners (`borderRadius["2xl"]` = 16px)
- Subtle shadow (`shadow.md`)
- 16px margin from edges
- Model selector pill at bottom-left inside composer
- Send button transitions to stop button when agent is running

**AC-11:** Composer has rounded pill shape with visible shadow.
**AC-12:** Model selector shows current model name as a subtle text pill.
**AC-13:** Send button shows arrow-up icon; transforms to square stop icon during agent run.

### 3.5 Sidebar — Date-Grouped Conversations

**EARS: When** the Claude Desktop layout is active, **the system shall** group sidebar items by recency: "Today", "Yesterday", "Previous 7 Days", "Previous 30 Days", "Older".

**AC-14:** Sidebar groups conversations by date bucket using `lastActivityAt`.
**AC-15:** Each group has a non-interactive text header.
**AC-16:** Conversations show title (or first 40 chars of prompt), truncated.
**AC-17:** Active conversation highlighted with `accent` left border.

### 3.6 Empty State — Welcome Message

**EARS: When** a new conversation is started (draft panel), **the system shall** display:

- Claude sparkle icon (large, centered)
- "How can I help you today?" heading
- 2-3 suggested prompt chips below

**AC-18:** Empty state shows centered welcome with sparkle icon.
**AC-19:** Suggested prompts are tappable and populate the composer.
**AC-20:** Welcome disappears as soon as user types or sends.

### 3.7 Thinking Blocks — Collapsible with Duration

**EARS: When** the agent emits thinking/reasoning content, **the system shall** render a collapsible "Thinking..." block that:

- Shows "Thinking..." label with animated dots while in progress
- Shows "Thought for X seconds" label when complete
- Collapsed by default; expandable to show thinking content

**AC-21:** Thinking block shows duration in seconds when complete.
**AC-22:** Thinking content collapsed by default, expandable on tap/click.
**AC-23:** Animated ellipsis during active thinking.

### 3.8 Tool Calls — Inline Collapsed Style

**EARS: When** rendering tool calls, **the system shall** display them as compact inline rows:

- Tool icon + tool name + brief args summary on one line
- Expandable to show full input/output
- Green checkmark when completed, red X on error, spinner when running

**AC-24:** Tool calls render as single-line summary by default.
**AC-25:** Status indicator (spinner/check/X) visible at left.
**AC-26:** Tap expands to full detail view.

### 3.9 Hover Actions

**EARS: When** the user hovers over a message block (desktop only), **the system shall** show action buttons:

- Copy button (copies message text)
- Retry button (for last assistant message only)

**AC-27:** Hover actions appear on mouse enter, disappear on mouse leave.
**AC-28:** Copy button copies plain text of the message.
**AC-29:** Actions only show on desktop (not mobile/tablet).

### 3.10 Keyboard Shortcuts

**EARS:** The following shortcuts **shall** work in Claude Desktop mode (most already exist):

| Shortcut         | Action               | Status                           |
| ---------------- | -------------------- | -------------------------------- |
| Cmd/Ctrl+N       | New conversation     | Existing (maps to new agent tab) |
| Cmd/Ctrl+Shift+N | New window           | Needs implementation             |
| Cmd/Ctrl+,       | Open settings        | Existing                         |
| Cmd/Ctrl+/       | Toggle sidebar       | Existing                         |
| Escape           | Cancel running agent | Existing                         |
| Enter            | Send message         | Existing                         |
| Shift+Enter      | New line in composer | Existing                         |
| Up arrow         | Edit last message    | Needs verification               |
| Cmd/Ctrl+Shift+C | Copy last response   | Needs implementation             |

**AC-30:** All listed shortcuts functional.
**AC-31:** Shortcut hints visible in menus/tooltips.

### 3.11 Settings — Modal Overlay

**EARS: When** the user opens settings, **the system shall** display settings as a modal overlay (not a full-screen navigation) in Claude Desktop mode.

**AC-32:** Settings renders as centered modal with backdrop blur.
**AC-33:** Press Escape or click backdrop to dismiss.
**AC-34:** All existing settings sections accessible within modal.

### 3.12 Conversation Management

**EARS:** The system **shall** support:

- Rename conversation inline (double-click title in sidebar)
- Delete conversation (swipe on mobile, right-click context menu on desktop)
- Pin conversation to top

**AC-35:** Double-click sidebar item enters inline rename mode.
**AC-36:** Right-click opens context menu with Rename, Pin, Delete.
**AC-37:** Delete requires confirmation.

---

## 4. Non-Goals (Keep As-Is)

- Multi-provider support — stays. Claude Desktop mode is a _theme/layout_, not a provider lock.
- Workspace/worktree features — stays. Hidden in Claude Desktop layout but accessible.
- File explorer, terminal, browser panels — stay. Hidden by default, togglable.
- Voice/dictation — stays as-is.
- Mobile responsive — stays. Claude Desktop mode applies on all viewports.

---

## 5. Technical Architecture

### 5.1 Layout Mode System

Add a `layoutMode` setting: `"workspace"` (current) | `"claude-desktop"`.

When `layoutMode === "claude-desktop"`:

- `workspace-screen.tsx` renders single agent panel (no splits)
- Sidebar uses date-grouped view instead of workspace/project view
- `MAX_CONTENT_WIDTH` = 680
- File/terminal/browser panels accessible via keyboard shortcuts but not shown by default

### 5.2 Theme Extension

Add `lightClaude` theme to the existing theme system:

- New entry in `unistyles.ts` themes map
- New entry in `THEME_TO_UNISTYLES` mapping
- Uses warm beige tokens defined in 3.1

### 5.3 Component Modifications

All changes are _conditional_ on layout mode. Existing workspace mode untouched.

| Component                        | Change                                                    | Scope                       |
| -------------------------------- | --------------------------------------------------------- | --------------------------- |
| `message.tsx` `UserMessage`      | Add bubble wrapper when `layoutMode === "claude-desktop"` | ~30 LOC                     |
| `message.tsx` `AssistantMessage` | Add avatar gutter                                         | ~20 LOC                     |
| `composer.tsx`                   | Floating pill variant                                     | ~40 LOC conditional styles  |
| `left-sidebar.tsx`               | Date-grouped variant                                      | ~100 LOC new grouping logic |
| `agent-stream-view.tsx`          | Centered column width                                     | Style override              |
| `settings-screen.tsx`            | Modal variant                                             | ~60 LOC wrapper             |
| New: `welcome-draft.tsx`         | Empty state with prompts                                  | ~80 LOC new component       |

---

## 6. Success Criteria

1. Side-by-side screenshot comparison with Claude Desktop App shows <5% visual divergence in layout, spacing, and color
2. All 37 acceptance criteria pass
3. Zero regressions in workspace mode (existing tests pass)
4. No new dependencies added (uses existing unistyles + reanimated + lucide)
5. Works on web (Electron) and native (iOS/Android)
