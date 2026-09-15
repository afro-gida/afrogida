---
name: screenshot-driven-spec-before-coding
description: "User walks through a new feature screen-by-screen with screenshots before Claude writes any code, then gives an explicit go-ahead."
metadata: 
  node_type: memory
  pinned: false
  originSessionId: 1edbd882-a1ef-4425-b097-87781a974104
  modified: 2026-09-14T20:25:15.746Z
---

When starting a new feature or app (for example, the admin panel build for the Afro Gıda project), this user prefers to walk through the requirements screen by screen using screenshots from an existing app or design, narrating in plain language what each button/field/counter should do, before any code is written. The user explicitly said (about the admin panel): "ilerde tek tek resimle anlatıcam sana nereye ne yapacağımızı sistemi kurma adım adım konuşçaz sonra başla diycem ben sana" ("later I'll explain to you one by one with pictures where we'll do what, we'll discuss building the system step by step, then I'll tell you to start").

Implication for future sessions: when a user message signals the start of a new feature build by sharing UI screenshots, do not start writing code yet — treat each screenshot as a spec-gathering step, acknowledge/restate what was understood in plain non-technical language, ask clarifying questions only where genuinely ambiguous (the user has invited this: "bana sorular da sorabilirsin"), and wait for an explicit go-ahead (e.g. "başla" / "başlayabilirsin") before implementing. Don't treat early screenshots or partial descriptions as permission to start building.
