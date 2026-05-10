# pi-seq-thinking

A [pi](https://github.com/earendil-works/pi-mono) extension that adds a `/seq-thinking <prompt>` command and a `sequentialthinking` tool for visible step-by-step reasoning checkpoints.

The extension records numbered thought references, supports revisions, lets the model branch into alternatives, and can converge branch tips into explicit synthesis or decision nodes before producing the final answer.

## Install

```bash
pi install git:github.com/xRyul/pi-seq-thinking
```

Restart `pi` or run `/reload` after installation.

## Try without installing

```bash
pi -e git:github.com/xRyul/pi-seq-thinking
```

## Usage

```text
/seq-thinking compare these two implementation options and recommend one
```

The command sends a hidden sequential-thinking prompt to the agent, enables the `sequentialthinking` tool only for that request, and restores your previous active tools after the run finishes.

## What it provides

- `/seq-thinking <prompt>` command for one-off visible sequential-thinking requests.
- `sequentialthinking` tool with stable `thoughtRef` labels such as `1`, `2`, `3.1.1`, and convergence refs such as `3Σ1`.
- Support for revisions with `revisesThoughtRef`.
- Support for alternative branches with stable `branchId` values.
- Support for explicit convergence with `convergesFromRefs` and `convergenceType`.
- Context cleanup so prior sequential-thinking tool calls do not pollute later prompts.

## Example branching DAG

For a prompt like "plan the safest migration from a legacy API to oRPC without breaking users", the model can keep one main line of thought, explore several alternatives, revise an earlier assumption, nest sub-branches inside a promising option, and converge only after comparing the branch tips.

```text
User request
  |
  v
[1 Clarify migration goal]
  |
  v
[2 List constraints: compatibility, review size, rollback]
  |
  v
[3 Define decision criteria]
  |
  +-- branchId: adapter
  |     |
  |     v
  |   [3.1.1 Add adapter layer first]
  |     |
  |     v
  |   [3.1.2 Keep REST and oRPC in parallel]
  |     |
  |     v
  |   [3.1.R1 Revise 3.1.2: parallel paths risk drift]
  |     |
  |     v
  |   [3.1.3 Add contract tests around both paths]
  |
  +-- branchId: rewrite
  |     |
  |     v
  |   [3.2.1 Rewrite endpoint directly]
  |     |
  |     v
  |   [3.2.2 Faster cleanup, larger review]
  |     |
  |     v
  |   [3.2.3 Reject unless endpoint is isolated]
  |
  +-- branchId: hybrid
        |
        v
      [3.3.1 Extract shared service first]
        |
        v
      [3.3.2 Choose data ownership per route]
        |
        +-- branchId: server-owned
        |     |
        |     v
        |   [3.3.2.1 Keep RSC-owned static reads]
        |
        +-- branchId: query-owned
              |
              v
            [3.3.2.2 Hydrate React Query for mutable lists]
              |
              v
            [3.3S1 Synthesize ownership rules]

[3.1.3] ------------------.
[3.2.3] -------------------+--> [3S1 Compare adapter, rewrite, hybrid]
[3.3S1] ------------------'              |
                                      v
                              [4 Recommend hybrid migration]
                                      |
                                      v
                              [5 Add rollout and rollback plan]
                                      |
                                      v
                              [6 Verify against constraints]
                                      |
                     .----------------+----------------.
                     |                                 |
                     v                                 v
         [6.1.1 CI/typecheck risks]       [6.2.1 deployment/env risks]
                     |                                 |
                     '----------------+----------------'
                                      |
                                      v
                           [6S1 Final risk synthesis]
                                      |
                                      v
                 [7 Final sequentialthinking call: nextThoughtNeeded=false]
                                      |
                                      v
                                Final answer
```

In this example, branches `3.1`, `3.2`, and `3.3` all start from `branchFromThoughtRef: "3"`; the hybrid branch then opens nested alternatives from `branchFromThoughtRef: "3.3.2"`. The revision node uses `revisesThoughtRef: "3.1.2"`, the convergence nodes use `convergesFromRefs` such as `["3.1.3", "3.2.3", "3.3Σ1"]`, and the final answer is delayed until the last `sequentialthinking` call sets `nextThoughtNeeded: false`. The ASCII diagram writes convergence refs as `3S1` and `6S1` for portability; tool results use sigma refs such as `3Σ1` and `6Σ1`.

## Development

Clone and symlink or run directly from the extension directory:

```bash
git clone https://github.com/xRyul/pi-seq-thinking.git
cd pi-seq-thinking
pi -e ./index.ts
```

## License

MIT
