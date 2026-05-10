# seq-thinking

A [pi](https://github.com/earendil-works/pi-mono) extension that adds a `/seq-thinking <prompt>` command and a `sequentialthinking` tool for visible step-by-step reasoning checkpoints.

The extension records numbered thought references, supports revisions, lets the model branch into alternatives, and can converge branch tips into explicit synthesis or decision nodes before producing the final answer.

## Install

```bash
pi install git:github.com/xRyul/seq-thinking
```

Restart `pi` or run `/reload` after installation.

## Try without installing

```bash
pi -e git:github.com/xRyul/seq-thinking
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

## Development

Clone and symlink or run directly from the extension directory:

```bash
git clone https://github.com/xRyul/seq-thinking.git
cd seq-thinking
pi -e ./index.ts
```

## License

MIT
