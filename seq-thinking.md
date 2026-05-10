---
description: Run a prompt with visible sequential-thinking tool calls
argument-hint: '<prompt>'
---

# Sequential Thinking Mode

User request:

$ARGUMENTS

You must use the `sequentialthinking` tool before answering. The tool records the visible reasoning process for this prompt.

Tool-use rules:

1. Call `sequentialthinking` once for each visible thought step.
2. Start with `thoughtNumber: 1` and an initial `totalThoughts` estimate.
3. Treat `thoughtNumber` as progress/order, not the stable reference. It may repeat across alternative branches. The tool assigns the stable `thoughtRef`.
4. Read the tool result after every call. It contains `thoughtRef`, `referenceMap`, `branchMap`, and `branchTips`.
5. Main path refs are `1`, `2`, `3`. Branch alternatives use hierarchical refs: the first alternative from `3` starts at `3.1.1`; the second starts at `3.2.1`; continuing branch `3.1` becomes `3.1.2`.
6. If you need to revise an earlier step, call the tool with `isRevision: true`. Use `revisesThought` only for unambiguous main thoughts; use exact `revisesThoughtRef` from `referenceMap` for branch or ambiguous thoughts.
7. If you explore alternatives, start each alternative with the same `branchFromThought` or `branchFromThoughtRef` and a distinct stable `branchId`.
8. Continue an existing branch by reusing its `branchId`. You do not need to repeat `branchFromThoughtRef` unless starting a new branch.
9. If you branch from a branch thought, use exact `branchFromThoughtRef` such as `3.1.1`.
10. When alternatives have been explored, add an explicit convergence thought with `convergesFromRefs` set to the relevant current refs, usually the refs in `branchTips`. Set `convergenceId` and `convergenceType` (`choose`, `synthesize`, `reject`, or `defer`) when useful.
11. Convergence refs use sigma notation such as `3Σ1`, meaning branches under thought `3` were merged into a convergence/synthesis node.
12. Adjust `totalThoughts` up or down as the task becomes clearer.
13. If you reach the estimate but need more steps, set `needsMoreThoughts: true`, increase `totalThoughts`, and keep going.
14. Your final `sequentialthinking` call must set `nextThoughtNeeded: false`.
15. Do not provide the final answer until after that final tool call.

Reasoning expectations:

- Break down complex problems into steps.
- Name assumptions, uncertainties, and missing context.
- Filter irrelevant information.
- Generate a solution hypothesis when appropriate.
- Branch into alternatives when multiple viable paths exist, and keep each alternative on its own `branchId`.
- Revise freely when new evidence contradicts earlier reasoning, using exact refs for the thought being corrected.
- Converge alternatives explicitly before making a final decision when multiple branches were explored.
- Verify the hypothesis against the prompt and relevant prior conversation.
- Repeat until satisfied.

Final answer:

After the final tool call, answer the user directly and concisely. If the user asks to list assumptions or compare behavior, include explicit sections for assumptions, preserved behavior, and unsupported or changed behavior.
