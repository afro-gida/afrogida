---
name: user-non-technical-background
description: "User has little/no software engineering background; they built their system (Afro Gıda backend/marketplace) through conversational AI assistance rather than writing code themselves, though the product architecture and decisions are their own."
metadata: 
  node_type: memory
  pinned: true
  originSessionId: d0ed81f2-d793-4a81-8327-71996a3191ec
  modified: 2026-09-11T16:54:20.602Z
---

The user explicitly said: "yazılım bilgim pek yok sistemi ben kurdum ama konuşarak kurdum mimarisi bana ait sadece" ("I don't have much software knowledge — I built the system, but I built it by talking [to an AI], the architecture is only mine"). This came up when Claude Code presented a multiple-choice question asking the user to pick between technical groupings of backend API endpoints to refactor next; the user could not evaluate the technical tradeoffs between the options.

Implication for future sessions: don't ask this user to choose between technical implementation options (e.g., "which module/endpoint group should I refactor next", "which library", "which architecture pattern") as if they can weigh the engineering tradeoffs. Instead, make the technical call yourself (pick the safest/most sensible default) and explain what you did and why in plain, non-jargon language. Reserve questions for the user for product/business-level decisions (what the feature should do, what the priority is, what the business rule should be) — those are the decisions that are genuinely theirs to make, since the product direction and architecture intent originated with them even though the implementation did not.
