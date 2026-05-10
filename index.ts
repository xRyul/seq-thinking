/**
 * Sequential Thinking Extension
 *
 * Usage:
 *   /seq-thinking <prompt>
 *   /seq-thinking list all assumptions you made in your previous response
 *
 * Provides a prompt template plus a `sequentialthinking` tool. The template
 * asks the model to call the tool once per visible thought step, including
 * revisions and branches, before giving the final answer.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { Static } from 'typebox';
import { Container, Text } from '@earendil-works/pi-tui';
import { Type } from 'typebox';

const baseDir = dirname(fileURLToPath(import.meta.url));
const TOOL_NAME = 'sequentialthinking';
const RESULT_MESSAGE_TYPE = 'seq-thinking-result';
const PROMPT_MESSAGE_TYPE = 'seq-thinking-prompt';
const SEQUENCE_TEMPLATE_START = '# Sequential Thinking Mode';
const SEQUENCE_REQUEST_START = 'User request:\n\n';
const SEQUENCE_REQUEST_END = '\n\nYou must use the `sequentialthinking` tool';

const ConvergenceTypeSchema = Type.Union([
  Type.Literal('choose'),
  Type.Literal('synthesize'),
  Type.Literal('reject'),
  Type.Literal('defer'),
]);

const ThoughtInputSchema = Type.Object({
  thought: Type.String({
    description: 'The current visible reasoning step',
  }),
  nextThoughtNeeded: Type.Boolean({
    description: 'Whether another thought step is needed',
  }),
  thoughtNumber: Type.Integer({
    minimum: 1,
    description: 'Current thought number, for example 1, 2, or 3',
  }),
  totalThoughts: Type.Integer({
    minimum: 1,
    description: 'Current estimate of the total thoughts needed',
  }),
  isRevision: Type.Optional(
    Type.Boolean({
      description: 'Whether this thought revises a previous thought',
    }),
  ),
  revisesThought: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: 'Which thought number is being reconsidered',
    }),
  ),
  revisesThoughtRef: Type.Optional(
    Type.String({
      description:
        'Reference label of the thought being revised, for example 2 or 3.1.1',
    }),
  ),
  branchFromThought: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: 'Thought number this branch starts from',
    }),
  ),
  branchFromThoughtRef: Type.Optional(
    Type.String({
      description:
        'Reference label of the thought this branch starts from, for example 3 or 3.1.1',
    }),
  ),
  branchId: Type.Optional(
    Type.String({
      description: 'Identifier for the current branch',
    }),
  ),
  convergesFromRefs: Type.Optional(
    Type.Array(
      Type.String({
        description:
          'Exact refs to merge or compare in this convergence thought',
      }),
      {
        description:
          'Thought refs being converged, for example ["2.1.3", "2.2.2"]',
      },
    ),
  ),
  convergenceId: Type.Optional(
    Type.String({
      description: 'Stable identifier for this convergence or synthesis point',
    }),
  ),
  convergenceType: Type.Optional(ConvergenceTypeSchema),
  needsMoreThoughts: Type.Optional(
    Type.Boolean({
      description:
        'Whether more thoughts are needed after reaching the estimate',
    }),
  ),
});

type ThoughtInput = Static<typeof ThoughtInputSchema>;
type ConvergenceType = Static<typeof ConvergenceTypeSchema>;
type ThoughtKind = 'thought' | 'revision' | 'convergence' | 'synthesis';
type ThoughtEdgeType = 'next' | 'branch' | 'revise' | 'converge';

type ThinkingState = {
  thoughtHistory: ThoughtInput[];
  branches: Record<string, ThoughtInput[]>;
};

type BranchMapEntry = {
  branchId: string;
  branchRef: string;
  branchFromThoughtRef: string;
  alternativeNumber: number;
  tipRef?: string;
};

type BranchTipEntry = {
  branchId: string;
  branchRef: string;
  thoughtRef: string;
};

type ThoughtGraphNode = {
  ref: string;
  kind: ThoughtKind;
  thoughtNumber: number;
  branchId?: string;
  branchRef?: string;
  preview: string;
};

type ThoughtGraphEdge = {
  fromRef: string;
  toRef: string;
  type: ThoughtEdgeType;
};

type ThoughtGraph = {
  nodes: ThoughtGraphNode[];
  edges: ThoughtGraphEdge[];
};

type ReferenceMapEntry = {
  ref: string;
  kind: ThoughtKind;
  thoughtNumber: number;
  branchId?: string;
  branchRef?: string;
  branchFromThoughtRef?: string;
  revisesThoughtRef?: string;
  convergesFromRefs?: string[];
  convergenceId?: string;
  convergenceType?: ConvergenceType;
  preview: string;
};

type SequentialThinkingDetails = {
  thoughtNumber: number;
  totalThoughts: number;
  nextThoughtNeeded: boolean;
  branches: string[];
  branchMap: BranchMapEntry[];
  referenceMap: ReferenceMapEntry[];
  branchTips: BranchTipEntry[];
  graph: ThoughtGraph;
  thoughtHistoryLength: number;
  thoughtRef?: string;
  branchRef?: string;
  branchFromThoughtRef?: string;
  revisesThoughtRef?: string;
  convergesFromRefs?: string[];
  convergenceId?: string;
  convergenceType?: ConvergenceType;
  currentThought: ThoughtInput;
  state: ThinkingState;
  sequenceId: string;
  originalRequest?: string;
};

type SequentialThinkingResultDetails = {
  state: ThinkingState;
  finalAnswer: string;
  originalRequest?: string;
};

type SequentialThinkingPromptDetails = {
  originalRequest?: string;
};

type ContextContentBlock = Record<string, unknown> & {
  type?: string;
  text?: string;
  name?: string;
};

type ContextMessage = Record<string, unknown> & {
  role?: string;
  content?: ContextContentBlock[];
  toolName?: string;
  timestamp?: number;
  customType?: string;
  details?: unknown;
};

type SequenceSessionManager = {
  getBranch(): Array<{
    id: string;
    type: string;
    parentId?: string | null;
    message?: ContextMessage;
    customType?: string;
    content?: unknown;
    details?: unknown;
  }>;
  branch(entryId: string): void;
  resetLeaf?: () => void;
  getLeafEntry():
    | {
        type: string;
        customType?: string;
      }
    | undefined;
  fileEntries?: Array<{ type: string; id?: string; parentId?: string | null }>;
  _buildIndex?: () => void;
  _rewriteFile?: () => void;
};

function coerceBoolean(value: unknown): unknown {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return value;
}

function coerceInteger(value: unknown): unknown {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  if (!/^[-+]?\d+$/.test(trimmed)) return value;
  return Number(trimmed);
}

function prepareThoughtArguments(args: unknown): ThoughtInput {
  if (!args || typeof args !== 'object') return args as ThoughtInput;

  const input = args as Record<string, unknown>;
  return {
    ...input,
    nextThoughtNeeded: coerceBoolean(input.nextThoughtNeeded),
    thoughtNumber: coerceInteger(input.thoughtNumber),
    totalThoughts: coerceInteger(input.totalThoughts),
    isRevision: coerceBoolean(input.isRevision),
    revisesThought: coerceInteger(input.revisesThought),
    branchFromThought: coerceInteger(input.branchFromThought),
    convergesFromRefs: normalizeReferenceList(input.convergesFromRefs),
    convergenceId: normalizeReference(input.convergenceId),
    convergenceType: normalizeConvergenceType(input.convergenceType),
    needsMoreThoughts: coerceBoolean(input.needsMoreThoughts),
  } as ThoughtInput;
}

function cloneState(state: ThinkingState): ThinkingState {
  return {
    thoughtHistory: state.thoughtHistory.map((thought) => ({ ...thought })),
    branches: Object.fromEntries(
      Object.entries(state.branches).map(([id, thoughts]) => [
        id,
        thoughts.map((thought) => ({ ...thought })),
      ]),
    ),
  };
}

type BranchReference = {
  branchId: string;
  parentRef: string;
  branchRef: string;
  alternativeNumber: number;
};

type ThoughtReference = {
  ref: string;
  thought: ThoughtInput;
  thoughtNumber: number;
  index: number;
  branchId?: string;
  branchRef?: string;
  branchFromRef?: string;
  revisesRef?: string;
  kind: ThoughtKind;
  convergesFromRefs?: string[];
  convergenceId?: string;
  convergenceType?: ConvergenceType;
};

type ReferenceState = {
  thoughts: ThoughtReference[];
  branches: BranchReference[];
};

function normalizeReference(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeReferenceList(value: unknown): string[] | undefined {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\s,]+/)
      : [];
  const references = values.flatMap((item) => {
    const reference = normalizeReference(item);
    return reference ? [reference] : [];
  });

  return references.length > 0 ? Array.from(new Set(references)) : undefined;
}

function normalizeConvergenceType(value: unknown): ConvergenceType | undefined {
  if (
    value === 'choose' ||
    value === 'synthesize' ||
    value === 'reject' ||
    value === 'defer'
  ) {
    return value;
  }

  return undefined;
}

function getThoughtPreview(thought: string): string {
  const normalized = thought.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 90) return normalized;
  return `${normalized.slice(0, 87)}...`;
}

function ensureUniqueThoughtRef(
  ref: string,
  references: ThoughtReference[],
): string {
  if (!references.some((reference) => reference.ref === ref)) return ref;

  let suffix = 2;
  while (references.some((reference) => reference.ref === `${ref}.${suffix}`)) {
    suffix += 1;
  }

  return `${ref}.${suffix}`;
}

function getReferenceCommonPrefix(refs: string[]): string | undefined {
  if (refs.length === 0) return undefined;

  const tokenizedRefs = refs.map((ref) => ref.split('.'));
  const prefix: string[] = [];
  const shortestLength = Math.min(
    ...tokenizedRefs.map((tokens) => tokens.length),
  );

  for (let index = 0; index < shortestLength; index += 1) {
    const token = tokenizedRefs[0]?.[index];
    if (!token) break;
    if (!tokenizedRefs.every((tokens) => tokens[index] === token)) break;
    prefix.push(token);
  }

  return prefix.length > 0 ? prefix.join('.') : undefined;
}

function createConvergenceRef(
  convergesFromRefs: string[],
  references: ThoughtReference[],
): string {
  const anchorRef = getReferenceCommonPrefix(convergesFromRefs);
  const prefix = anchorRef ? `${anchorRef}Σ` : 'Σ';
  const existingCount = references.filter((reference) =>
    reference.ref.startsWith(prefix),
  ).length;

  return ensureUniqueThoughtRef(`${prefix}${existingCount + 1}`, references);
}

function getThoughtKind(
  thought: ThoughtInput,
  convergesFromRefs: string[],
): ThoughtKind {
  if (convergesFromRefs.length > 0) {
    return thought.convergenceType === 'synthesize'
      ? 'synthesis'
      : 'convergence';
  }

  return thought.isRevision ? 'revision' : 'thought';
}

function resolveThoughtReference(
  references: ThoughtReference[],
  ref: string | undefined,
  thoughtNumber: number | undefined,
  preferredBranchId?: string,
): string | undefined {
  const normalizedRef = normalizeReference(ref);
  if (normalizedRef) return normalizedRef;
  if (typeof thoughtNumber !== 'number') return undefined;

  if (preferredBranchId) {
    const branchMatch = references.find(
      (reference) =>
        reference.branchId === preferredBranchId &&
        reference.thoughtNumber === thoughtNumber,
    );
    if (branchMatch) return branchMatch.ref;
  }

  const mainRef = String(thoughtNumber);
  const mainMatch = references.find(
    (reference) => reference.ref === mainRef && !reference.branchId,
  );
  if (mainMatch) return mainMatch.ref;

  const matches = references.filter(
    (reference) => reference.thoughtNumber === thoughtNumber,
  );
  if (matches.length === 1) return matches[0]?.ref;

  return mainRef;
}

function getOrCreateBranchReference(
  thought: ThoughtInput,
  references: ThoughtReference[],
  branchesById: Map<string, BranchReference>,
  branchesByParent: Map<string, BranchReference[]>,
): BranchReference | undefined {
  const explicitBranchId = normalizeReference(thought.branchId);
  const explicitParentRef = resolveThoughtReference(
    references,
    thought.branchFromThoughtRef,
    thought.branchFromThought,
  );

  if (!explicitBranchId && !explicitParentRef) return undefined;

  const parentRef = explicitParentRef ?? '?';
  const branchId =
    explicitBranchId ??
    `branch-${parentRef}-${(branchesByParent.get(parentRef)?.length ?? 0) + 1}`;
  const existing = branchesById.get(branchId);
  if (existing) return existing;

  let siblings = branchesByParent.get(parentRef);
  if (!siblings) {
    siblings = [];
    branchesByParent.set(parentRef, siblings);
  }

  const alternativeNumber = siblings.length + 1;
  const branchReference = {
    branchId,
    parentRef,
    branchRef: `${parentRef}.${alternativeNumber}`,
    alternativeNumber,
  };

  branchesById.set(branchId, branchReference);
  siblings.push(branchReference);

  return branchReference;
}

function buildReferenceState(state: ThinkingState): ReferenceState {
  const thoughts: ThoughtReference[] = [];
  const branchesById = new Map<string, BranchReference>();
  const branchesByParent = new Map<string, BranchReference[]>();

  for (const [index, thought] of state.thoughtHistory.entries()) {
    const branchReference = getOrCreateBranchReference(
      thought,
      thoughts,
      branchesById,
      branchesByParent,
    );
    const convergesFromRefs =
      normalizeReferenceList(thought.convergesFromRefs) ?? [];
    const kind = getThoughtKind(thought, convergesFromRefs);
    const branchStep = branchReference
      ? thoughts.filter(
          (reference) => reference.branchId === branchReference.branchId,
        ).length + 1
      : undefined;
    const baseRef =
      convergesFromRefs.length > 0
        ? createConvergenceRef(convergesFromRefs, thoughts)
        : branchReference
          ? `${branchReference.branchRef}.${branchStep}`
          : String(thought.thoughtNumber);
    const ref = ensureUniqueThoughtRef(baseRef, thoughts);
    const revisesRef = resolveThoughtReference(
      thoughts,
      thought.revisesThoughtRef,
      thought.revisesThought,
      branchReference?.branchId,
    );
    const explicitBranchFromRef = resolveThoughtReference(
      thoughts,
      thought.branchFromThoughtRef,
      thought.branchFromThought,
    );

    thoughts.push({
      ref,
      thought,
      thoughtNumber: thought.thoughtNumber,
      index,
      kind,
      branchId: branchReference?.branchId,
      branchRef: branchReference?.branchRef,
      branchFromRef: branchReference?.parentRef ?? explicitBranchFromRef,
      revisesRef,
      convergesFromRefs:
        convergesFromRefs.length > 0 ? convergesFromRefs : undefined,
      convergenceId: normalizeReference(thought.convergenceId),
      convergenceType: normalizeConvergenceType(thought.convergenceType),
    });
  }

  return {
    thoughts,
    branches: Array.from(branchesById.values()),
  };
}

function createReferenceMap(state: ReferenceState): ReferenceMapEntry[] {
  return state.thoughts.map((reference) => {
    const entry: ReferenceMapEntry = {
      ref: reference.ref,
      kind: reference.kind,
      thoughtNumber: reference.thoughtNumber,
      preview: getThoughtPreview(reference.thought.thought),
    };

    if (reference.branchId) entry.branchId = reference.branchId;
    if (reference.branchRef) entry.branchRef = reference.branchRef;
    if (reference.branchFromRef) {
      entry.branchFromThoughtRef = reference.branchFromRef;
    }
    if (reference.revisesRef) entry.revisesThoughtRef = reference.revisesRef;
    if (reference.convergesFromRefs) {
      entry.convergesFromRefs = reference.convergesFromRefs;
    }
    if (reference.convergenceId) entry.convergenceId = reference.convergenceId;
    if (reference.convergenceType) {
      entry.convergenceType = reference.convergenceType;
    }

    return entry;
  });
}

function createBranchTips(state: ReferenceState): BranchTipEntry[] {
  const tips = new Map<string, ThoughtReference>();

  for (const reference of state.thoughts) {
    if (reference.branchId) tips.set(reference.branchId, reference);
  }

  return state.branches.flatMap((branch) => {
    const tip = tips.get(branch.branchId);
    return tip
      ? [
          {
            branchId: branch.branchId,
            branchRef: branch.branchRef,
            thoughtRef: tip.ref,
          },
        ]
      : [];
  });
}

function createBranchMap(state: ReferenceState): BranchMapEntry[] {
  const tips = new Map(
    createBranchTips(state).map((tip) => [tip.branchId, tip.thoughtRef]),
  );

  return state.branches.map((branch) => {
    const entry: BranchMapEntry = {
      branchId: branch.branchId,
      branchRef: branch.branchRef,
      branchFromThoughtRef: branch.parentRef,
      alternativeNumber: branch.alternativeNumber,
    };
    const tipRef = tips.get(branch.branchId);
    if (tipRef) entry.tipRef = tipRef;
    return entry;
  });
}

function addGraphEdge(edges: ThoughtGraphEdge[], edge: ThoughtGraphEdge): void {
  const exists = edges.some(
    (candidate) =>
      candidate.fromRef === edge.fromRef &&
      candidate.toRef === edge.toRef &&
      candidate.type === edge.type,
  );
  if (!exists) edges.push(edge);
}

function findPreviousReference(
  references: ThoughtReference[],
  currentIndex: number,
  predicate: (reference: ThoughtReference) => boolean,
): ThoughtReference | undefined {
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const reference = references[index];
    if (reference && predicate(reference)) return reference;
  }

  return undefined;
}

function createThoughtGraph(state: ReferenceState): ThoughtGraph {
  const edges: ThoughtGraphEdge[] = [];

  for (const [index, reference] of state.thoughts.entries()) {
    const previousSameBranch = reference.branchId
      ? findPreviousReference(
          state.thoughts,
          index,
          (candidate) => candidate.branchId === reference.branchId,
        )
      : undefined;

    if (previousSameBranch) {
      addGraphEdge(edges, {
        fromRef: previousSameBranch.ref,
        toRef: reference.ref,
        type: 'next',
      });
    } else if (reference.branchId && reference.branchFromRef) {
      addGraphEdge(edges, {
        fromRef: reference.branchFromRef,
        toRef: reference.ref,
        type: 'branch',
      });
    } else if (!reference.branchId && !reference.convergesFromRefs) {
      const previousMain = findPreviousReference(
        state.thoughts,
        index,
        (candidate) => !candidate.branchId,
      );
      if (previousMain) {
        addGraphEdge(edges, {
          fromRef: previousMain.ref,
          toRef: reference.ref,
          type: 'next',
        });
      }
    }

    for (const fromRef of reference.convergesFromRefs ?? []) {
      addGraphEdge(edges, {
        fromRef,
        toRef: reference.ref,
        type: 'converge',
      });
    }

    if (reference.revisesRef) {
      addGraphEdge(edges, {
        fromRef: reference.revisesRef,
        toRef: reference.ref,
        type: 'revise',
      });
    }
  }

  return {
    nodes: state.thoughts.map((reference) => {
      const node: ThoughtGraphNode = {
        ref: reference.ref,
        kind: reference.kind,
        thoughtNumber: reference.thoughtNumber,
        preview: getThoughtPreview(reference.thought.thought),
      };
      if (reference.branchId) node.branchId = reference.branchId;
      if (reference.branchRef) node.branchRef = reference.branchRef;
      return node;
    }),
    edges,
  };
}

function getThoughtHeader(reference: ThoughtReference): string {
  const { thought } = reference;
  const isConvergence = Boolean(reference.convergesFromRefs?.length);
  const icon = isConvergence
    ? reference.kind === 'synthesis'
      ? '🧬'
      : '🔀'
    : thought.isRevision
      ? reference.branchId
        ? '🔄🌿'
        : '🔄'
      : reference.branchId
        ? '🌿'
        : '💭';
  const label = isConvergence
    ? reference.kind === 'synthesis'
      ? 'Synthesis'
      : 'Convergence'
    : 'Thought';
  const metadata = [`${thought.thoughtNumber}/${thought.totalThoughts}`];

  if (reference.branchId) {
    metadata.push(
      `branch ${reference.branchRef ?? '?'}:${reference.branchId} from ${
        reference.branchFromRef ?? '?'
      }`,
    );
  } else if (reference.branchFromRef) {
    metadata.push(`from ${reference.branchFromRef}`);
  }

  if (reference.convergesFromRefs?.length) {
    metadata.push(`converges ${reference.convergesFromRefs.join(', ')}`);
  }
  if (reference.convergenceType) {
    metadata.push(reference.convergenceType);
  }
  if (reference.convergenceId) {
    metadata.push(`ID: ${reference.convergenceId}`);
  }
  if (thought.isRevision) {
    metadata.push(`revises ${reference.revisesRef ?? '?'}`);
  }

  return `${icon} ${label} ${reference.ref} (${metadata.join(', ')})`;
}

function getThoughtReferenceKindLabel(reference: {
  kind?: ThoughtKind;
  currentThought?: ThoughtInput;
  convergesFromRefs?: string[];
}): string {
  if (reference.convergesFromRefs?.length) {
    return reference.kind === 'synthesis' ? 'Synthesis' : 'Convergence';
  }

  if (reference.kind === 'revision' || reference.currentThought?.isRevision) {
    return 'Revision';
  }

  return 'Thought';
}

function formatThoughtReferenceStatus(reference: ThoughtReference): string {
  const kind = getThoughtReferenceKindLabel(reference);
  return `Sequential thinking: ${kind} ${reference.ref} (${reference.thoughtNumber}/${reference.thought.totalThoughts}) recorded`;
}

function wrapText(value: string, maxWidth: number): string[] {
  const output: string[] = [];

  for (const rawLine of value.split('\n')) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      output.push('');
      continue;
    }

    let current = '';
    for (const word of words) {
      if (!current) {
        current = word;
        continue;
      }

      if (`${current} ${word}`.length <= maxWidth) {
        current += ` ${word}`;
      } else {
        output.push(current);
        current = word;
      }
    }

    if (current) output.push(current);
  }

  return output;
}

function boxLines(lines: string[]): string[] {
  const width = Math.min(
    110,
    Math.max(24, ...lines.map((line) => line.length)),
  );
  const border = '─'.repeat(width + 2);

  return [
    `┌${border}┐`,
    ...lines.map((line) => `│ ${line.padEnd(width)} │`),
    `└${border}┘`,
  ];
}

function formatDagNodeLabel(
  referenceState: ReferenceState,
  ref: string,
): string {
  const reference = referenceState.thoughts.find(
    (thought) => thought.ref === ref,
  );
  if (!reference) return ref;

  const labels = [reference.branchId, reference.convergenceId].filter(
    (label): label is string => Boolean(label),
  );
  return labels.length > 0 ? `${ref} (${labels.join(', ')})` : ref;
}

function getConvergenceVerb(reference: ThoughtReference | undefined): string {
  if (!reference?.convergenceType) return '';
  return ` ${reference.convergenceType}`;
}

function formatConvergenceDagLines(
  referenceState: ReferenceState,
  toRef: string,
  fromRefs: string[],
): string[] {
  const target = formatDagNodeLabel(referenceState, toRef);
  const convergence = referenceState.thoughts.find(
    (reference) => reference.ref === toRef,
  );
  const verb = getConvergenceVerb(convergence);

  if (fromRefs.length === 1) {
    const source = formatDagNodeLabel(referenceState, fromRefs[0] ?? '?');
    return [`  ${source} ─Σ${verb}→ ${target}`];
  }

  return fromRefs.map((fromRef, index) => {
    const source = formatDagNodeLabel(referenceState, fromRef);
    if (index === 0) return `  ${source} ─┐`;
    if (index === fromRefs.length - 1) {
      return `  ${source} ─┴Σ${verb}→ ${target}`;
    }
    return `  ${source} ─┤`;
  });
}

function formatDagLines(referenceState: ReferenceState): string[] {
  const graph = createThoughtGraph(referenceState);
  if (graph.nodes.length === 0) return ['DAG: none'];

  const lines = ['DAG:'];

  for (const reference of referenceState.thoughts) {
    const incomingEdges = graph.edges.filter(
      (edge) => edge.toRef === reference.ref,
    );
    const convergenceEdges = incomingEdges.filter(
      (edge) => edge.type === 'converge',
    );
    const nonConvergenceEdges = incomingEdges.filter(
      (edge) => edge.type !== 'converge',
    );

    for (const edge of nonConvergenceEdges) {
      const source = formatDagNodeLabel(referenceState, edge.fromRef);
      const target = formatDagNodeLabel(referenceState, edge.toRef);
      if (edge.type === 'branch') {
        lines.push(`  ${source} ├─branch→ ${target}`);
      } else if (edge.type === 'revise') {
        lines.push(`  ${source} ↺ revises→ ${target}`);
      } else {
        lines.push(`  ${source} ─→ ${target}`);
      }
    }

    if (convergenceEdges.length > 0) {
      lines.push(
        ...formatConvergenceDagLines(
          referenceState,
          reference.ref,
          convergenceEdges.map((edge) => edge.fromRef),
        ),
      );
    }
  }

  if (lines.length === 1) {
    lines.push(
      `  ${graph.nodes
        .map((node) => formatDagNodeLabel(referenceState, node.ref))
        .join(' · ')}`,
    );
  }

  return lines;
}

function formatStateLines(
  state: ThinkingState,
  originalRequest?: string,
): string[] {
  const lines = ['Sequential Thinking'];
  const request = originalRequest?.trim();

  if (request) {
    lines.push('');
    for (const line of wrapText(request, 96)) {
      lines.push(line);
    }
  }

  const referenceState = buildReferenceState(state);

  if (referenceState.thoughts.length === 0) {
    lines.push('', 'No thoughts recorded yet.');
  }

  for (const reference of referenceState.thoughts) {
    lines.push('', formatThoughtReferenceStatus(reference));
    for (const line of wrapText(reference.thought.thought, 96)) {
      lines.push(line);
    }
  }

  return lines;
}

function getTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        Boolean(block) &&
        typeof block === 'object' &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string',
    )
    .map((block) => block.text)
    .join('');
}

function extractSequenceRequest(text: string): string | undefined {
  const normalized = text.trimStart();
  if (!normalized.startsWith(SEQUENCE_TEMPLATE_START)) return undefined;

  const requestStart = normalized.indexOf(SEQUENCE_REQUEST_START);
  if (requestStart === -1) return undefined;

  const contentStart = requestStart + SEQUENCE_REQUEST_START.length;
  const requestEnd = normalized.indexOf(SEQUENCE_REQUEST_END, contentStart);
  if (requestEnd === -1) return undefined;

  return normalized.slice(contentStart, requestEnd).trim();
}

function extractSequenceCommandRequest(text: string): string | undefined {
  const trimmed = text.trimStart();
  const [commandName = ''] = trimmed.split(/\s+/, 1);
  if (commandName !== '/seq-thinking') return undefined;

  const request = trimmed.slice(commandName.length).trim();
  return request || undefined;
}

function createSequencePrompt(request: string): string {
  return `${SEQUENCE_TEMPLATE_START}

User request:

${request}

You must use the \`sequentialthinking\` tool before answering. The tool records the visible reasoning process for this prompt.

Tool-use rules:

1. Call \`sequentialthinking\` once for each visible thought step.
2. Start with \`thoughtNumber: 1\` and an initial \`totalThoughts\` estimate.
3. Treat \`thoughtNumber\` as progress/order, not the stable reference. The tool assigns \`thoughtRef\`.
4. Read each tool result for \`thoughtRef\`, \`referenceMap\`, \`branchMap\`, and \`branchTips\`.
5. Branch alternatives with distinct stable \`branchId\` values; continue a branch by reusing its \`branchId\`.
6. Revise with \`isRevision: true\` and prefer exact \`revisesThoughtRef\` for branch or ambiguous thoughts.
7. Converge explored alternatives with \`convergesFromRefs\`, usually using refs from \`branchTips\`; set \`convergenceId\` and \`convergenceType\` when useful.
8. Adjust \`totalThoughts\` as the task becomes clearer.
9. Your final \`sequentialthinking\` call must set \`nextThoughtNeeded: false\`.
10. Do not provide the final answer until after that final tool call.

Final answer:

After the final tool call, answer the user directly and concisely.`;
}

function isSequentialThinkingToolCall(block: ContextContentBlock): boolean {
  return block.type === 'toolCall' && block.name === TOOL_NAME;
}

function normalizeSequenceUserMessage(message: ContextMessage): ContextMessage {
  if (!Array.isArray(message.content)) return message;

  let changed = false;
  const content = message.content.map((block) => {
    if (block.type !== 'text' || typeof block.text !== 'string') {
      return block;
    }

    const request = extractSequenceRequest(block.text);
    if (!request) return block;

    changed = true;
    return {
      ...block,
      text: `User asked with external sequential thinking: ${request}`,
    };
  });

  return changed ? { ...message, content } : message;
}

function normalizeSequencePromptMessage(
  message: ContextMessage,
): ContextMessage | undefined {
  const details = message.details as
    | SequentialThinkingPromptDetails
    | undefined;
  const request =
    details?.originalRequest?.trim() ||
    extractSequenceRequest(getTextContent(message.content));
  if (!request) return undefined;

  return {
    ...message,
    content: [
      {
        type: 'text',
        text: `User asked with external sequential thinking: ${request}`,
      },
    ],
  };
}

function normalizeSequenceResultMessage(
  message: ContextMessage,
): ContextMessage {
  if (message.customType !== RESULT_MESSAGE_TYPE) return message;

  const details = message.details as
    | SequentialThinkingResultDetails
    | undefined;
  const finalAnswer =
    details?.finalAnswer?.trim() || getTextContent(message.content);
  const request = details?.originalRequest?.trim();
  const text = request
    ? `External sequential thinking request:\n\n${request}\n\nFinal answer:\n\n${finalAnswer}`
    : `External sequential thinking final answer:\n\n${finalAnswer}`;
  return {
    ...message,
    content: [
      {
        type: 'text',
        text,
      },
    ],
  };
}

function cleanSequenceContextMessage(
  message: ContextMessage,
  activeSequenceStartedAt: number | undefined,
): ContextMessage | undefined {
  if (activeSequenceStartedAt !== undefined) {
    if (typeof message.timestamp !== 'number') return message;
    if (message.timestamp >= activeSequenceStartedAt) return message;
  }

  if (message.role === 'toolResult' && message.toolName === TOOL_NAME) {
    return undefined;
  }

  if (message.role === 'assistant' && Array.isArray(message.content)) {
    const content = message.content.filter(
      (block) => !isSequentialThinkingToolCall(block),
    );

    if (content.length === 0) return undefined;
    if (content.length !== message.content.length) {
      return { ...message, content };
    }
  }

  if (message.role === 'custom' && message.customType === PROMPT_MESSAGE_TYPE) {
    return normalizeSequencePromptMessage(message);
  }

  if (message.role === 'custom' && message.customType === RESULT_MESSAGE_TYPE) {
    return normalizeSequenceResultMessage(message);
  }

  if (message.role === 'user') {
    return normalizeSequenceUserMessage(message);
  }

  return message;
}

function getSequenceResultFinalAnswer(
  message: ContextMessage,
): string | undefined {
  if (message.role !== 'custom' || message.customType !== RESULT_MESSAGE_TYPE) {
    return undefined;
  }

  const details = message.details as
    | SequentialThinkingResultDetails
    | undefined;
  return details?.finalAnswer?.trim() || getTextContent(message.content).trim();
}

function getAssistantText(message: ContextMessage): string | undefined {
  if (message.role !== 'assistant') return undefined;
  const text = getTextContent(message.content).trim();
  return text || undefined;
}

function isDuplicateSequenceAssistant(
  message: ContextMessage,
  finalAnswers: Set<string>,
): boolean {
  const text = getAssistantText(message);
  return text !== undefined && finalAnswers.has(text);
}

function cleanSequenceContextMessages(
  messages: ContextMessage[],
  activeSequenceStartedAt: number | undefined,
): ContextMessage[] {
  const finalAnswers = new Set(
    messages.flatMap((message) => {
      const finalAnswer = getSequenceResultFinalAnswer(message);
      return finalAnswer ? [finalAnswer] : [];
    }),
  );

  return messages.flatMap((message) => {
    if (isDuplicateSequenceAssistant(message, finalAnswers)) {
      return [];
    }

    const cleaned = cleanSequenceContextMessage(
      message,
      activeSequenceStartedAt,
    );
    return cleaned ? [cleaned] : [];
  });
}

function findSequencePromptEntry(manager: { getBranch(): unknown[] }):
  | {
      id: string;
      parentId: string | null;
      request: string;
    }
  | undefined {
  const branch = manager.getBranch() as Array<{
    id: string;
    parentId?: string | null;
    type: string;
    customType?: string;
    content?: unknown;
    details?: unknown;
    message?: ContextMessage;
  }>;

  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (
      entry.type === 'custom_message' &&
      entry.customType === PROMPT_MESSAGE_TYPE
    ) {
      const details = entry.details as
        | SequentialThinkingPromptDetails
        | undefined;
      const request =
        details?.originalRequest?.trim() ||
        extractSequenceRequest(getTextContent(entry.content));
      if (request) {
        return { id: entry.id, parentId: entry.parentId ?? null, request };
      }
      continue;
    }

    if (entry.type !== 'message') continue;
    if (entry.message?.role !== 'user') continue;

    const request = extractSequenceRequest(
      getTextContent(entry.message.content),
    );
    if (request) {
      return { id: entry.id, parentId: entry.parentId ?? null, request };
    }
  }

  return undefined;
}

function findLastAssistantText(messages: ContextMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'assistant') continue;

    const text = getTextContent(message.content).trim();
    if (text) return text;
  }

  return undefined;
}

function getSequenceEntriesFromAnchor(
  manager: SequenceSessionManager,
  anchorEntryId: string,
): Set<string> {
  const branch = manager.getBranch();
  const anchorIndex = branch.findIndex((entry) => entry.id === anchorEntryId);
  if (anchorIndex === -1) return new Set();

  return new Set(
    branch
      .slice(anchorIndex)
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === 'string'),
  );
}

function branchToEntryParent(
  manager: SequenceSessionManager,
  entry: { id: string; parentId: string | null },
): boolean {
  if (entry.parentId) {
    manager.branch(entry.parentId);
    return true;
  }

  if (manager.resetLeaf) {
    manager.resetLeaf();
    return true;
  }

  manager.branch(entry.id);
  return false;
}

function pruneEntriesIfPossible(
  manager: SequenceSessionManager,
  entryIds: Set<string>,
): void {
  if (entryIds.size === 0) return;
  if (!manager.fileEntries || !manager._buildIndex || !manager._rewriteFile)
    return;

  manager.fileEntries = manager.fileEntries.filter(
    (entry) => entry.type === 'session' || !entry.id || !entryIds.has(entry.id),
  );
  manager._buildIndex();
  manager._rewriteFile();
}

export default function seqThinkingExtension(pi: ExtensionAPI) {
  let state: ThinkingState = { thoughtHistory: [], branches: {} };
  let previousActiveTools: string[] | undefined;
  let sequencePromptActive = false;
  let sequenceCounter = 0;
  let currentSequenceId = createSequenceId();
  let activeSequenceStartedAt: number | undefined;
  let sequenceAnchorEntryId: string | undefined;
  let sequenceAnchorParentEntryId: string | null | undefined;
  let sequenceOriginalRequest: string | undefined;
  let sequenceFinalAnswer: string | undefined;

  function createSequenceId(): string {
    sequenceCounter += 1;
    return `${Date.now()}-${sequenceCounter}`;
  }

  function resetState(): void {
    state = { thoughtHistory: [], branches: {} };
    currentSequenceId = createSequenceId();
    sequenceAnchorEntryId = undefined;
    sequenceAnchorParentEntryId = undefined;
    sequenceOriginalRequest = undefined;
    sequenceFinalAnswer = undefined;
  }

  function disableToolByDefault(): void {
    const activeTools = pi.getActiveTools();
    if (!activeTools.includes(TOOL_NAME)) return;
    pi.setActiveTools(activeTools.filter((toolName) => toolName !== TOOL_NAME));
  }

  function renderSequenceResult(
    details: SequentialThinkingResultDetails | undefined,
  ): string {
    const finalAnswer = details?.finalAnswer?.trim() ?? '';
    const lines = details?.state
      ? formatStateLines(details.state, details.originalRequest)
      : [];

    return [
      ...lines,
      '',
      'Final answer',
      finalAnswer || '(no final answer captured)',
    ].join('\n');
  }

  function formatThoughtStatus(details: SequentialThinkingDetails): string {
    const ref = details.thoughtRef ?? String(details.thoughtNumber);
    const kind = getThoughtReferenceKindLabel({
      kind: details.convergesFromRefs?.length
        ? details.convergenceType === 'synthesize'
          ? 'synthesis'
          : 'convergence'
        : undefined,
      currentThought: details.currentThought,
      convergesFromRefs: details.convergesFromRefs,
    });

    return `Sequential thinking: ${kind} ${ref} (${details.thoughtNumber}/${details.totalThoughts}) recorded`;
  }

  function formatThoughtResult(details: SequentialThinkingDetails): string {
    return [
      formatThoughtStatus(details),
      ...wrapText(details.currentThought.thought, 96),
    ].join('\n');
  }

  function enableSequenceTool(): void {
    const activeTools = pi.getActiveTools();
    if (activeTools.includes(TOOL_NAME)) return;

    previousActiveTools = activeTools;
    pi.setActiveTools([...activeTools, TOOL_NAME]);
  }

  function startSequenceRequest(request: string): void {
    resetState();
    activeSequenceStartedAt = Date.now();
    sequenceOriginalRequest = request;
    sequencePromptActive = true;
    enableSequenceTool();
  }

  function sendHiddenSequencePrompt(request: string): void {
    pi.sendMessage(
      {
        customType: PROMPT_MESSAGE_TYPE,
        content: createSequencePrompt(request),
        display: false,
        details: {
          originalRequest: request,
        } satisfies SequentialThinkingPromptDetails,
      },
      { triggerTurn: true },
    );
  }

  function finalizeSequenceResult(
    _messages: ContextMessage[],
    _ctx: { sessionManager: unknown },
  ): void {
    // Thoughts are rendered as individual tool results, and the final answer is
    // left as the normal assistant response. Keep completion work here so the
    // lifecycle hook remains explicit without adding a duplicate custom box.
  }
  pi.on('resources_discover', () => ({
    promptPaths: [join(baseDir, 'seq-thinking.md')],
  }));

  pi.on('session_start', (_event, ctx) => {
    resetState();

    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== 'message') continue;
      const message = entry.message;
      if (message.role !== 'toolResult') continue;
      if (message.toolName !== TOOL_NAME) continue;

      const details = message.details as SequentialThinkingDetails | undefined;
      if (details?.state) {
        state = cloneState(details.state);
      }
    }

    disableToolByDefault();
    activeSequenceStartedAt = undefined;
  });

  pi.on('input', (event, ctx) => {
    const commandName = event.text.trimStart().split(/\s+/, 1)[0];
    if (commandName !== '/seq-thinking') return undefined;

    const request = extractSequenceCommandRequest(event.text);
    if (!request) {
      ctx.ui.notify('Usage: /seq-thinking <prompt>', 'warning');
      return { action: 'handled' as const };
    }

    startSequenceRequest(request);
    sendHiddenSequencePrompt(request);

    return { action: 'handled' as const };
  });

  pi.on('agent_end', (event, ctx) => {
    if (!sequencePromptActive) return undefined;

    finalizeSequenceResult(event.messages as ContextMessage[], ctx);

    sequencePromptActive = false;
    activeSequenceStartedAt = undefined;

    if (previousActiveTools) {
      pi.setActiveTools(previousActiveTools);
      previousActiveTools = undefined;
    }

    return undefined;
  });

  pi.on('message_end', (event) => {
    if (!sequencePromptActive) return undefined;
    if (event.message.role !== 'assistant') return undefined;

    const finalAnswer = getTextContent(
      (event.message as ContextMessage).content,
    ).trim();
    if (!finalAnswer) return undefined;

    sequenceFinalAnswer = finalAnswer;

    return undefined;
  });

  pi.on('context', (event) => ({
    messages: cleanSequenceContextMessages(
      event.messages as ContextMessage[],
      activeSequenceStartedAt,
    ) as typeof event.messages,
  }));

  pi.registerMessageRenderer(
    RESULT_MESSAGE_TYPE,
    (message, _options, theme) => {
      const details = message.details as
        | SequentialThinkingResultDetails
        | undefined;
      return new Text(theme.fg('text', renderSequenceResult(details)), 0, 0);
    },
  );

  pi.registerTool({
    name: TOOL_NAME,
    label: 'Sequential Thinking',
    description: `A detailed tool for dynamic and reflective problem-solving through visible thought steps.
Use this tool when a /seq-thinking prompt asks you to reason step by step.
Each call records one visible thought. Use repeated calls for each next thought,
revision, or branch, then answer only after nextThoughtNeeded is false.

The tool assigns hierarchical reference labels. Main thoughts are 1, 2, 3.
Alternative branches from thought 3 become 3.1.1, 3.2.1, etc. Continue
a branch by reusing its branchId. Convergences merge branch tips into refs like
3Σ1. Revise, branch, or converge from prior thoughts using returned
referenceMap and branchTips; prefer exact refs because bare thought numbers can
be ambiguous.

Parameters:
- thought: Current visible thinking step. Include analysis, revisions, questions,
  approach changes, hypothesis generation, or hypothesis verification.
- nextThoughtNeeded: true if another thought step is needed.
- thoughtNumber: Current progress/order number. It can repeat across alternatives;
  the tool assigns unique thoughtRef labels.
- totalThoughts: Current estimate of thoughts needed. Adjust up or down as needed.
- isRevision: true if this revises an earlier thought.
- revisesThought: Numeric thought number being reconsidered when unambiguous.
- revisesThoughtRef: Exact thoughtRef being reconsidered, for example 2.1.1.
- branchFromThought: Numeric thought number this branch starts from when unambiguous.
- branchFromThoughtRef: Exact thoughtRef this branch starts from, for example 3.1.1.
- branchId: Stable identifier for the current branch or alternative path.
- convergesFromRefs: Exact refs to merge/compare in a convergence thought.
- convergenceId: Stable identifier for the convergence point.
- convergenceType: choose, synthesize, reject, or defer.
- needsMoreThoughts: true if more thoughts are needed after reaching the estimate.

Do not skip directly to the answer. Keep calling sequentialthinking while
nextThoughtNeeded is true.`,
    promptSnippet:
      'Record visible sequential thinking steps with numbered refs, revisions, branch alternatives, and convergence nodes',
    promptGuidelines: [
      'Use sequentialthinking only when the user invokes /seq-thinking or explicitly asks for visible sequential thinking.',
      'Use the returned thoughtRef/referenceMap when revising, branching, or converging branch thoughts.',
      'When branching into alternatives, create one stable branchId per alternative and reuse it while continuing that branch.',
      'When alternatives have been explored, add an explicit convergence thought with convergesFromRefs set to the relevant branch tips.',
      'When using sequentialthinking, call it once per visible thought, revision, branch, or convergence and continue until nextThoughtNeeded is false before giving the final answer.',
    ],
    parameters: ThoughtInputSchema,
    executionMode: 'sequential',
    renderShell: 'self',
    prepareArguments: prepareThoughtArguments,

    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      const thought: ThoughtInput = { ...params };
      thought.branchId = normalizeReference(thought.branchId);
      thought.branchFromThoughtRef = normalizeReference(
        thought.branchFromThoughtRef,
      );
      thought.revisesThoughtRef = normalizeReference(thought.revisesThoughtRef);
      thought.convergesFromRefs = normalizeReferenceList(
        thought.convergesFromRefs,
      );
      thought.convergenceId = normalizeReference(thought.convergenceId);
      thought.convergenceType = normalizeConvergenceType(
        thought.convergenceType,
      );

      if (!sequenceAnchorEntryId) {
        const promptEntry = findSequencePromptEntry(ctx.sessionManager);
        if (promptEntry) {
          sequenceAnchorEntryId = promptEntry.id;
          sequenceAnchorParentEntryId = promptEntry.parentId;
          sequenceOriginalRequest = promptEntry.request;
        }
      }

      if (thought.thoughtNumber > thought.totalThoughts) {
        thought.totalThoughts = thought.thoughtNumber;
      }

      state.thoughtHistory.push(thought);

      const explicitBranchId = normalizeReference(thought.branchId);
      if (explicitBranchId) {
        state.branches[explicitBranchId] ??= [];
        state.branches[explicitBranchId].push(thought);
      }

      const referenceState = buildReferenceState(state);
      const currentReference =
        referenceState.thoughts[referenceState.thoughts.length - 1];
      const branchMap = createBranchMap(referenceState);
      const branchTips = createBranchTips(referenceState);
      const graph = createThoughtGraph(referenceState);
      const summary = {
        thoughtNumber: thought.thoughtNumber,
        totalThoughts: thought.totalThoughts,
        thoughtRef: currentReference?.ref,
        branchRef: currentReference?.branchRef,
        branchFromThoughtRef: currentReference?.branchFromRef,
        revisesThoughtRef: currentReference?.revisesRef,
        convergesFromRefs: currentReference?.convergesFromRefs,
        convergenceId: currentReference?.convergenceId,
        convergenceType: currentReference?.convergenceType,
        nextThoughtNeeded: thought.nextThoughtNeeded,
        branches: branchMap.map((branch) => branch.branchId),
        branchMap,
        referenceMap: createReferenceMap(referenceState),
        branchTips,
        graph,
        thoughtHistoryLength: state.thoughtHistory.length,
        originalRequest: sequenceOriginalRequest,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(summary, null, 2),
          },
        ],
        details: {
          ...summary,
          currentThought: thought,
          state: cloneState(state),
          sequenceId: currentSequenceId,
        } satisfies SequentialThinkingDetails,
      };
    },

    renderCall() {
      return new Container();
    },

    renderResult(result, _options, theme, _context) {
      const details = result.details as SequentialThinkingDetails | undefined;
      if (!details?.state) {
        const text = result.content[0];
        return new Text(text?.type === 'text' ? text.text : '', 0, 0);
      }

      return new Text(theme.fg('muted', formatThoughtResult(details)), 0, 0);
    },
  });
}
