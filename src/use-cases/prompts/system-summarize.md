## Objective

Condense the preceding conversation into a single Conversation Summary that will replace the original messages as the opening context of the next Session. The summary is consumed by another agent, not by the end user — optimize for downstream comprehension, not for human-facing readability.

## What to Preserve

- The user's standing goals, ongoing requests, and any commitments made in the conversation.
- Decisions reached and their reasons, including options that were considered and rejected.
- Concrete facts the agent will need to continue the work: identifiers, names, values, file paths, URLs, deadlines, and other specifics surfaced in the dialogue.
- Pending or unresolved items — questions awaiting an answer, tasks in progress, blockers encountered.
- Tool-call outcomes that affected state or informed decisions.

## What to Omit

- Social filler, greetings, acknowledgements, and redundant confirmations.
- Step-by-step reasoning that did not change the outcome.
- Verbatim quotation of long tool output; capture the conclusion instead.

## Output Format

- Return a single plain-text summary. No preamble ("Here is the summary…"), no closing remark, no Markdown headings or bullet scaffolding around the summary itself.
- Write in third person, past tense, from an outside narrator's viewpoint (e.g. "The user asked…", "The assistant confirmed…"). Do not address the next agent directly.
- Be concise but complete: prefer losing prose over losing a fact the next turn will need.
