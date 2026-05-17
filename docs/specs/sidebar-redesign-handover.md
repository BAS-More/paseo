# Handover: Sidebar Redesign — Match Claude Code Desktop App

**Date:** 2026-05-17  
**Session:** blissful-spence-4f75cb  
**Repo:** C:\Dev\tools\paseo (Paseo frontend)

---

## What was done this session

### 1. Rate limit fix (COMPLETED + MERGED)

- Fixed `stackAndClaudeLimiter` in `server/index.js` (BnM-Claude-CLI repo) — added explicit `windowMs: 60_000` and `max: 60` to prevent express-rate-limit defaulting to 5 req/min
- PR [#49](https://github.com/BAS-More/BnM-Claude-CLI/pull/49) — merged

### 2. Sidebar redesign spec (COMPLETED, NOT YET PR'd)

- Full spec written at: `C:\Dev\tools\paseo\docs\specs\sidebar-claude-code-redesign.md`
- Spec is an untracked file in Paseo repo on branch `fix/nix-npm-fetcher-v2`
- Needs its own branch + PR before implementation starts

---

## What needs to happen next

### Immediate: Create branch + commit spec

```bash
cd C:\Dev\tools\paseo
git checkout main
git checkout -b feat/sidebar-claude-code-redesign
git add docs/specs/sidebar-claude-code-redesign.md
git commit -m "docs: add sidebar redesign spec to match Claude Code Desktop"
git push -u origin feat/sidebar-claude-code-redesign
```

### Then: Implement the redesign

The spec is at `docs/specs/sidebar-claude-code-redesign.md`. Key decisions already made:

- **Replace entirely** — no toggle between project-grouped and session-grouped views
- **Full spec first** approach — spec is done, implementation is next

---

## Architecture context (what I learned exploring the codebase)

### Key files in Paseo

| File                                                     | Purpose                                                                                            | Lines                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------- | ------ |
| `packages/app/src/components/left-sidebar.tsx`           | Main sidebar container. Already has `claude-desktop` mode with date grouping + search. ~1300 lines | Key                               |
| `packages/app/src/components/sidebar-workspace-list.tsx` | Renders workspace rows (branch names, diff stats, PR badges). ~3123 lines                          | Replace                           |
| `packages/app/src/components/agent-list.tsx`             | Renders agent sessions with titles + date sections. Used in sessions-screen only. ~400 lines       | Reference                         |
| `packages/app/src/hooks/use-sidebar-workspaces-list.ts`  | Provides workspace data grouped by project. ~200 lines                                             | Swap out                          |
| `packages/app/src/hooks/use-agent-history.ts`            | Provides paginated agent history (titles, status, dates). ~120 lines                               | Swap in                           |
| `packages/app/src/stores/session-store.ts`               | `Agent` type with `title`, `status`, `createdAt`, `labels`                                         | Types                             |
| `packages/app/src/types/agent-directory.ts`              | `AgentDirectoryEntry` — Pick of Agent fields                                                       | Types                             |
| `packages/app/src/hooks/use-settings.ts`                 | `LayoutMode = "workspace"                                                                          | "claude-desktop"` — remove toggle | Modify |
| `packages/app/src/stores/pinned-workspaces-store.ts`     | Pinning by workspace key — extend to agent keys                                                    | Modify                            |

### The core problem

The `claude-desktop` layout mode (lines 824-890 of `left-sidebar.tsx`) already date-groups sessions, but it groups **workspace entries** (branch names like `claude/blissful-spence-4f75cb`). The target shows **agent sessions** with descriptive titles (like "Fix overly restrictive stackAndClau..."). The data source needs to change from `useSidebarWorkspacesList` to `useAgentHistory`.

### Existing infrastructure that helps

- `left-sidebar.tsx:84-110` — `DateBucket` type and `getDateBucket()` already exist
- `agent-list.tsx:99-125` — `deriveDateSectionLabel()` already groups by Today/Yesterday/This Week/etc.
- `agent-list.tsx:177-282` — `SessionRow` component already renders title + provider icon + status
- `use-agent-history.ts` — Already returns `AggregatedAgent[]` with all needed fields
- `pinned-workspaces-store.ts` — Pinning infrastructure exists

### What the target UI needs (see spec section 3 for ASCII diagram)

1. **Tab bar**: Chat / Cowork / Code (new component)
2. **Quick actions**: + New session, Routines, Customize, More (new component)
3. **Date-grouped sessions**: Today, Yesterday, then specific dates like "May 15" (modify date logic)
4. **Session rows**: Status icon + title, not branch name (new component, data source swap)
5. **User/model footer**: "Avi · Max" (new component)

### 5 new components needed

- `sidebar-tab-bar.tsx` — segmented control
- `sidebar-quick-actions.tsx` — action list
- `sidebar-session-list.tsx` — date-grouped FlatList of sessions
- `sidebar-session-row.tsx` — single session row
- `sidebar-user-footer.tsx` — bottom bar

### Styling system

- `react-native-unistyles` with `StyleSheet.create((theme) => ({...}))`
- Theme has: `colors`, `spacing`, `fontSize`, `borderRadius`, `iconSize`
- Key colors: `foreground`, `foregroundMuted`, `surfaceSidebar`, `surfaceSidebarHover`, `border`, `palette.*`

---

## Estimated effort

4-5 days total (see spec section 15 for breakdown)

---

## Other notes

- The `SidebarWorkspaceList` component must be kept — it's still used by the explorer sidebar (`explorer-sidebar.tsx`)
- The `use-sidebar-workspaces-list.ts` hook should also be kept for explorer
- Paseo uses Expo Router for navigation, React Native for rendering, Zustand for state
- The Paseo repo is currently on branch `fix/nix-npm-fetcher-v2` with some unrelated dirty files (.dockerignore, Dockerfile, numbered files in packages/server/)
