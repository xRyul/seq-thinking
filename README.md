# pi-seq-thinking

Simple `pi` extension to breakdown complex problem into subproblems. 

Simply type `/seq-thikning <your very hard problem to solve>`.

Some of common pattern for problem breakdown:

- Advantage and Disadvantages: `/seq-thinking List 2 advantages and disadvatnages of life` 
- Dive deeper `/seq-thinking List 2 advantages and disadvatnages of life. For each list 5 counterpoints.` 
- Even deeper `/seq-thinking List 2 advantages and disadvatnages of life. For each create 5 branhces where each branch has 1 counterpoint. For each counterpoints branch of and create a hypothesis - 1 hypothesis per branch with 5 total Then for each hypothesis create 2 other branhces: 1 rbanch where you decide why it is testable hypothesis, 2nd branch why it is not testable hypotheiss. Think only about the ones which testable hypothesis. Get back with yoru anwser` 
- Or even more crazy if you dont care baout cost of tokens:

 ```markdown                                                                       
   /seq-thinking Build a visible reasoning DAG about life.                     
                                                                               
   Task:                                                                       
   1. Start with 4 main claims:                                                
      - 2 advantages of life                                                   
      - 2 disadvantages of life                                                
                                                                               
   2. For each main claim, create exactly 5 counterpoint branches.             
      - Each counterpoint must be a separate branch.                           
      - Use a unique branchId like:                                            
        claim-1-counterpoint-1                                                 
        claim-1-counterpoint-2                                                 
      - Start each counterpoint with branchFromThoughtRef set to the exact     
 main claim ref.                                                               
                                                                               
   3. For each counterpoint, create exactly 1 nested hypothesis branch.        
      - Do NOT continue the counterpoint branch.                               
      - Create a new branchId like:                                            
        claim-1-counterpoint-1-hypothesis                                      
      - Set branchFromThoughtRef to the exact counterpoint thoughtRef, e.g.    
 1.1.1.                                                                        
      - This should produce deeper refs like 1.1.1.1.1.                        
                                                                               
   4. For each hypothesis, create exactly 2 nested evaluation branches:        
      - one branchId ending in -testable                                       
      - one branchId ending in -not-testable                                   
      - Set branchFromThoughtRef to the exact hypothesis thoughtRef.           
      - Decide whether the hypothesis is testable.                             
                                                                               
   5. Continue reasoning only for hypotheses whose testable branch concludes   
 they are testable.                                                            
                                                                               
   6. Use convergesFromRefs to synthesize:                                     
      - each claim’s testable hypothesis branch tips                           
      - then all claim-level syntheses into one final conclusion.              
                                                                               
   Rules:                                                                      
   - A new nested branch requires a new branchId and exact                     
 branchFromThoughtRef.                                                         
   - Reusing branchId continues that branch; do not reuse it when creating a   
 child branch.                                                                 
   - Read each sequentialthinking result and use its thoughtRef/referenceMap   
 for the next branchFromThoughtRef.                                            
   - Do not flatten the tree.                                                  
   - Stop only when the final sequentialthinking call has nextThoughtNeeded:   
 false.                                                                        
                                                                               
   Final answer:                                                               
   Give a concise summary of the testable hypotheses and the final conclusion. 
 ```



## Install

```bash
pi install git:github.com/xRyul/pi-seq-thinking
```

Restart `pi` or run `/reload` after installation.


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

