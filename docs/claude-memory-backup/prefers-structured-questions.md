---
name: prefers-structured-questions
description: User prefers structured multiple-choice question prompts (AskUserQuestion) over plain-text yes/no questions when asking for approval or a decision.
metadata: 
  node_type: memory
  pinned: false
  originSessionId: d0ed81f2-d793-4a81-8327-71996a3191ec
  modified: 2026-09-11T16:48:22.920Z
---

When Claude Code offered to use the AskUserQuestion tool (structured, selectable multiple-choice prompts) instead of plain free-text questions for approvals and decision points, the user explicitly confirmed with "kullan" ("use it"). Going forward, when checking in for approval before an action or asking the user to choose between options, prefer AskUserQuestion's structured option format over a plain text question, so the user gets clickable choices rather than having to type a free-form reply.
