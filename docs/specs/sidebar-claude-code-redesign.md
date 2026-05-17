# Spec: Sidebar Redesign — Match Claude Code Desktop App

**Status:** Draft  
**Author:** Claude (for Avi)  
**Date:** 2026-05-17  
**Target repo:** C:\Dev\tools\paseo

---

## 1. Goal

Replace the current project-grouped sidebar with a session-based sidebar that matches the Claude Code Desktop App layout. The new sidebar shows agent sessions grouped by date with descriptive titles, a tab bar, quick actions, and a user/model footer.

## 2. Current State

The Paseo sidebar (`left-sidebar.tsx`) has two layout modes controlled by `appSettings.layoutMode`:

| Mode                  | Grouping                                        | Row content                       | Header                              | Footer                             |
| --------------------- | ----------------------------------------------- | --------------------------------- | ----------------------------------- | ---------------------------------- |
| `workspace` (default) | By git project/repo                             | Branch name, diff stats, PR badge | "+ New Agent" button                | Host picker, add project, settings |
| `claude-desktop`      | By date bucket (Today/Yesterday/This Week/etc.) | Branch name (same workspace rows) | Search bar, SquarePen + Globe icons | Hidden                             |

**Problem:** Even in `claude-desktop` mode, the sidebar shows **workspace entries** (branch names) rather than **agent sessions** (titles). The target Claude Code Desktop App shows session titles like "Fix overly restrictive stackAndClau..." grouped by date.

## 3. Target UI (Claude Code Desktop App — RIGHT screenshot)

```
┌─────────────────────────────────┐
│  Chat   Cowork   ◆ Code        │  ← Tab bar (Code tab active)
├─────────────────────────────────┤
│  + New session                  │  ← Quick action
│  ⚡ Routines                    │  ← Quick action
│  🔒 Customize                   │  ← Quick action
│  ˅ More                         │  ← Expandable
├─────────────────────────────────┤
│  Pinned                         │  ← Section header
│  🔧 Run BnM platform code...   │
│  🔧 Add Facebook video link... │
│  🔁 Review Well Vintage proj...│
├─────────────────────────────────┤
│  Today                     ⚙   │  ← Section header + filter
│  ··  Handover preparation...    │  ← Status: running/loading
│  🔧 Fix overly restrictive...  │  ← Status: tool-use (selected)
│  ○  Add isContainedIn guard...  │
│  🔧 Sanitize err.message...    │
│  ○  Fix pre-existing Zod...     │
├─────────────────────────────────┤
│  May 15                         │
│  🔁 Soifer                      │
│  ●  Handover preparation...     │
│  ○  Fix Nix build (never-gr... │
│  🔧 Find open source anim...   │
├─────────────────────────────────┤
│  May 14                         │
│  🔧 Review testteam repos...   │
│  🔁 Analyze spec-kit repo...   │
│  ○  Fix all MCP issues          │
├─────────────────────────────────┤
│  May 13                         │
│  ○  Fix slow fetch_agents_r... │
│  ●  Fix lint-staged v16 sta... │
│  ○  Clone NVIDIA Nemotron...    │
├─────────────────────────────────┤
│  Ⓐ Avi · Max ˅                 │  ← User + model selector
└─────────────────────────────────┘
```

## 4. Gap Analysis

| #   | Feature                               | Current state                             | Target                                                    | Effort                                                   |
| --- | ------------------------------------- | ----------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------- |
| G1  | **Session titles in sidebar**         | Shows workspace branch names              | Shows agent session titles (`agent.title`)                | High — swap data source from workspaces to agent history |
| G2  | **Tab bar (Chat/Cowork/Code)**        | Not present                               | Three tabs at top of sidebar                              | Medium — new component, routing integration              |
| G3  | **Quick actions row**                 | Single "+ New Agent" button               | New session, Routines, Customize, More                    | Medium — new list items with icons                       |
| G4  | **Date grouping with specific dates** | Buckets only (Today/This Week/This Month) | Today, Yesterday, then specific dates (May 15, May 14...) | Low — modify `deriveDateSectionLabel`                    |
| G5  | **Session status icons**              | Workspace status dots (colored circles)   | Tool-use wrench, code icon, running dots, colored fills   | Medium — new icon resolver based on agent status/labels  |
| G6  | **User/model footer**                 | Hidden in claude-desktop mode             | "Avi · Max ˅" with model selector                         | Low — new footer component                               |
| G7  | **Remove project-grouped view**       | Default mode shows projects               | Replace entirely with session view                        | Low — change default, remove toggle                      |
| G8  | **Pinned sessions**                   | Pinned workspaces exist                   | Pinned sessions (same concept, different data)            | Medium — adapt pinning to agent IDs                      |

## 5. Data Model Change

### Current: Workspace-based sidebar

```
useSidebarWorkspacesList() → SidebarProjectEntry[] → SidebarWorkspaceList
  - Groups by: git project (repo name)
  - Row data: branch name, diffStat, status dot, PR badge
  - Identity: workspaceKey (serverId:workspaceId)
```

### Target: Agent-session-based sidebar

```
useAgentHistory() → AggregatedAgent[] → SidebarSessionList (NEW)
  - Groups by: date (Today, Yesterday, specific dates)
  - Row data: session title, status icon, provider icon
  - Identity: agentKey (serverId:agentId)
```

### Key type: `AggregatedAgent` (already exists)

```typescript
{
  id: string;
  serverId: string;
  serverLabel: string;
  title: string | null; // Session title (what we display)
  status: AgentLifecycleStatus; // initializing|idle|running|error|closed
  lastActivityAt: Date; // For date grouping
  cwd: string; // Project path
  provider: AgentProvider; // For provider icon
  pendingPermissionCount: number;
  requiresAttention: boolean;
  attentionReason: string | null;
  attentionTimestamp: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  labels: Record<string, string>; // For status icon hints
}
```

## 6. Component Plan

### 6.1 New components (in `packages/app/src/components/`)

| Component                   | Purpose                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| `sidebar-tab-bar.tsx`       | "Chat / Cowork / Code" segmented control                                    |
| `sidebar-quick-actions.tsx` | New session, Routines, Customize, More                                      |
| `sidebar-session-list.tsx`  | Date-grouped agent session list (replaces SidebarWorkspaceList in new mode) |
| `sidebar-session-row.tsx`   | Single session row: status icon + title + hover actions                     |
| `sidebar-user-footer.tsx`   | "Avi · Max ˅" bottom bar                                                    |

### 6.2 Modified components

| Component          | Change                                                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `left-sidebar.tsx` | Remove `layoutMode` conditional — always render session-based layout. Remove `dateGroupedProjects` logic (moving to `sidebar-session-list`). Wire new components. |
| `agent-list.tsx`   | Extract `deriveDateSectionLabel` to shared util (reuse in sidebar)                                                                                                |

### 6.3 Modified hooks/utils

| File                   | Change                                                                           |
| ---------------------- | -------------------------------------------------------------------------------- |
| `use-settings.ts`      | Remove `layoutMode` from `AppSettings` (or keep for backwards compat but ignore) |
| `use-agent-history.ts` | No changes needed — already returns what we need                                 |

### 6.4 Deleted/deprecated

| File                                  | Reason                                                       |
| ------------------------------------- | ------------------------------------------------------------ |
| `sidebar-project-row-model.ts`        | No longer needed (project grouping removed)                  |
| `sidebar-collapsed-sections-store.ts` | Replace with date-section collapse state                     |
| `use-sidebar-workspaces-list.ts`      | No longer used in sidebar (may still be needed for explorer) |

## 7. Date Grouping Logic

Replace the current bucket approach with specific dates for older sessions:

```typescript
function deriveDateSectionLabel(date: Date): string {
  const now = new Date();
  const todayStart = startOfDay(now);
  const yesterdayStart = subDays(todayStart, 1);
  const activityStart = startOfDay(date);

  if (activityStart >= todayStart) return "Today";
  if (activityStart >= yesterdayStart) return "Yesterday";

  // For dates within the last 7 days, show day name
  const diffDays = daysBetween(activityStart, todayStart);
  if (diffDays <= 7) return formatDayName(date); // "Monday", "Tuesday", etc.

  // For older dates, show "Month Day" format
  return formatMonthDay(date); // "May 15", "May 14", etc.
}
```

## 8. Session Status Icons

Map agent state to icons matching Claude Code Desktop:

| Agent state             | Icon                | Color      |
| ----------------------- | ------------------- | ---------- |
| `running` + tool active | 🔧 Wrench           | Amber      |
| `running` + streaming   | `···` animated dots | Foreground |
| `idle` (recent)         | ● Filled circle     | Blue       |
| `closed` (completed)    | ○ Empty circle      | Muted      |
| `error`                 | ● Filled circle     | Red        |
| `requiresAttention`     | ● Filled circle     | Amber      |
| Labels hint: "cowork"   | 🔁 Repeat icon      | Purple     |

## 9. Tab Bar Behavior

| Tab    | Route                     | Content                                   |
| ------ | ------------------------- | ----------------------------------------- |
| Chat   | `/h/[serverId]/chat`      | Future: chat-only sessions (stub for now) |
| Cowork | `/h/[serverId]/cowork`    | Future: cowork sessions (stub for now)    |
| Code   | `/h/[serverId]` (default) | Current session list — active immediately |

Initially, all three tabs show the same session list. Tab switching can be wired to filter by session type later.

## 10. Quick Actions

| Action        | Icon        | Behavior                                            |
| ------------- | ----------- | --------------------------------------------------- |
| + New session | Plus        | Opens project picker (existing `handleOpenProject`) |
| Routines      | Zap         | Opens routines screen (if exists) or stub           |
| Customize     | Lock/Shield | Opens customization/settings                        |
| More          | ChevronDown | Expandable — shows additional options               |

## 11. Pinning

Adapt existing `usePinnedWorkspacesStore` to support agent keys (`serverId:agentId`) in addition to workspace keys. The pinned section appears above date groups, same as current behavior.

## 12. Migration / Backwards Compatibility

- Remove `layoutMode` toggle from settings screen
- Default all users to the new session-based sidebar
- Keep `SidebarWorkspaceList` component intact (used by explorer sidebar)
- Keep `use-sidebar-workspaces-list.ts` hook (used by explorer)

## 13. Acceptance Criteria

- [ ] Sidebar shows agent sessions with titles (not branch names)
- [ ] Sessions grouped by date: Today, Yesterday, then specific dates (May 15, etc.)
- [ ] Tab bar with Chat/Cowork/Code at top (Code active by default)
- [ ] Quick actions: New session, Routines, Customize, More
- [ ] Session rows show status icon + title (single line, truncated)
- [ ] Pinned section at top with pinned sessions
- [ ] User/model footer at bottom ("Avi · Max")
- [ ] Selected session highlighted
- [ ] Right-click context menu on sessions (archive, pin, etc.)
- [ ] Search functionality preserved
- [ ] Project-grouped view removed from sidebar
- [ ] No regressions in explorer sidebar or other views
- [ ] TypeScript compiles clean
- [ ] Existing tests pass

## 14. Risk Assessment

| Risk                                        | Impact | Mitigation                                                            |
| ------------------------------------------- | ------ | --------------------------------------------------------------------- |
| Explorer sidebar still needs workspace list | Medium | Keep `SidebarWorkspaceList` component, only change `left-sidebar.tsx` |
| Agent history fetch is paginated (200/page) | Low    | Already handled by `useAgentHistory` with infinite scroll             |
| Pinning store uses workspace keys           | Medium | Extend store to support both key types, or migrate keys               |
| Tab routing doesn't exist yet               | Low    | Tabs are visual-only initially, wire routing later                    |
| Session titles can be null                  | Low    | Fall back to "New session" (already done in `agent-list.tsx`)         |

## 15. Estimated Effort

| Task                                                                       | Estimate     |
| -------------------------------------------------------------------------- | ------------ |
| New components (tab bar, quick actions, session list, session row, footer) | 1-2 days     |
| Modify left-sidebar.tsx to wire new components                             | 0.5 day      |
| Date grouping with specific dates                                          | 0.5 day      |
| Status icon resolver                                                       | 0.5 day      |
| Pinning migration                                                          | 0.5 day      |
| Remove layout mode toggle, cleanup                                         | 0.5 day      |
| Testing and polish                                                         | 0.5 day      |
| **Total**                                                                  | **4-5 days** |
