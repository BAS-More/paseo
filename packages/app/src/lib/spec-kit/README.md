# spec-kit helpers

Building blocks for surfacing **command handoffs** in the Paseo UI.

Pattern adapted from [github/spec-kit](https://github.com/github/spec-kit) (MIT). A slash-command markdown file can declare follow-up actions in its YAML frontmatter; after the assistant turn that ran the command finishes, Paseo renders those as one-click chips next to the composer.

```yaml
---
description: Create or update the feature specification.
handoffs:
  - label: Build Technical Plan
    agent: speckit.plan
    prompt: Create a plan for the spec
  - label: Clarify Spec Requirements
    agent: speckit.clarify
    prompt: Clarify specification requirements
    send: true
---
```

| Field    | Required | Meaning                                                                                                                                         |
| -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `label`  | yes      | Text on the chip                                                                                                                                |
| `agent`  | yes      | Slash command or subagent the chip targets (informational; not used to switch agents automatically)                                             |
| `prompt` | yes      | Text to populate into the composer (or submit, if `send: true`)                                                                                 |
| `send`   | no       | When `true`, pressing the chip submits the prompt immediately. When omitted or `false`, the chip populates the composer and waits for the user. |

## Modules

- `handoffs.ts` — dependency-free YAML-subset parser (`extractFrontmatter`, `parseHandoffs`)
- `handoffs.test.ts` — parser tests, including the real spec-kit `specify.md` shape
- `../components/handoff-chips.tsx` — UI component (matches existing `PromptChip` style)
- `../components/handoff-chips.test.tsx` — chip behavior tests

## Integration (follow-up work, not done yet)

The parser and component ship as standalone primitives. Wiring them into the live stream needs two upstream decisions first:

1. **Where slash-command frontmatter is parsed.** Today, Paseo agents receive the rendered prompt body, not the source markdown — frontmatter is stripped before the prompt reaches the agent. We need either (a) the server to attach a `handoffs: Handoff[]` to the assistant message, or (b) the client to fetch the source markdown for the command that was just run.

2. **Where chips render in the stream.** Likely site: after the last assistant message of the turn, above the composer. `agent-stream-view.tsx` currently renders `SUGGESTED_PROMPTS` only in the empty state — handoffs should render in the populated state, attached to the most recent assistant turn.

Once those two decisions land, integration is roughly:

```tsx
// in agent-stream-view.tsx, when rendering the trailing assistant message:
{
  lastAssistantTurn?.handoffs && lastAssistantTurn.handoffs.length > 0 ? (
    <HandoffChips
      handoffs={lastAssistantTurn.handoffs}
      onSelect={(handoff) => {
        if (handoff.send) {
          submitPrompt(handoff.prompt);
        } else {
          onSuggestedPrompt?.(handoff.prompt);
        }
      }}
    />
  ) : null;
}
```

## Why a hand-written parser

`js-yaml` would be ~25 KB minified and pulls a parser tree we don't otherwise use. The handoff shape is fixed (a list of mappings with scalar string values), so a 60-line parser covers the use case and stays well within unit-test budget. If we later need broader YAML support elsewhere in the app, swap this module out for `yaml` or `js-yaml` and keep the same exports.
