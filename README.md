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

```mermaid
flowchart LR
    Q(["User request"]) --> T1["1 Clarify migration goal"]
    T1 --> T2["2 List constraints: compatibility, review size, rollback"]
    T2 --> T3["3 Define decision criteria"]

    T3 -->|branchId: adapter| A1["3.1.1 Add adapter layer first"]
    A1 --> A2["3.1.2 Keep REST and oRPC in parallel"]
    A2 -. isRevision revisesThoughtRef: 3.1.2 .-> AR["3.1.R1 Revision: parallel paths risk drift"]
    AR --> A3["3.1.3 Add contract tests around both paths"]

    T3 -->|branchId: rewrite| B1["3.2.1 Rewrite endpoint directly"]
    B1 --> B2["3.2.2 Faster cleanup, larger review"]
    B2 --> B3["3.2.3 Reject unless endpoint is isolated"]

    T3 -->|branchId: hybrid| C1["3.3.1 Extract shared service first"]
    C1 --> C2["3.3.2 Choose data ownership per route"]
    C2 -->|branchId: server-owned| C21["3.3.2.1 Keep RSC-owned static reads"]
    C2 -->|branchId: query-owned| C22["3.3.2.2 Hydrate React Query for mutable lists"]
    C21 ==> CConv["3.3Σ1 Synthesize ownership rules"]
    C22 ==> CConv

    A3 ==> S1["3Σ1 Compare adapter, rewrite, hybrid"]
    B3 ==> S1
    CConv ==> S1

    S1 --> R1["4 Recommend hybrid migration"]
    R1 --> R2["5 Add rollout and rollback plan"]
    R2 --> R3["6 Verify against constraints"]
    R3 -. needsMoreThoughts: true .-> Risk1["6.1.1 Branch: CI and typecheck risks"]
    R3 -. needsMoreThoughts: true .-> Risk2["6.2.1 Branch: deployment and env risks"]
    Risk1 ==> FinalConv["6Σ1 Final risk synthesis"]
    Risk2 ==> FinalConv
    FinalConv --> F["7 Final tool call: nextThoughtNeeded = false"]
    F --> Answer(["Final answer"])
```

In this example, branches `3.1`, `3.2`, and `3.3` all start from `branchFromThoughtRef: "3"`; the hybrid branch then opens nested alternatives from `branchFromThoughtRef: "3.3.2"`. The revision node uses `revisesThoughtRef: "3.1.2"`, the convergence nodes use `convergesFromRefs` such as `["3.1.3", "3.2.3", "3.3Σ1"]`, and the final answer is delayed until the last `sequentialthinking` call sets `nextThoughtNeeded: false`.

## Development

Clone and symlink or run directly from the extension directory:

```bash
git clone https://github.com/xRyul/pi-seq-thinking.git
cd pi-seq-thinking
pi -e ./index.ts
```

## License

MIT
