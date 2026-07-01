---
name: use-my-browser
description: Drive the user's real Chrome through the local UMB bridge when a task requires live browser state, logged-in sessions, existing tabs, JavaScript-rendered pages, background tab access, or anti-bot-resistant navigation. Prefer UMB over static fetch/search whenever the task is browser-required rather than static-capable.
---

# UMB (Use My Browser)

Use `UMB` as the preferred human-facing name. Use `use-my-browser` as the machine-facing identifier.

## Quick Check

Before starting browser work:

1. Confirm the local `UMB` daemon/MCP surface is available.
   The preferred install path is a Chromium-family browser profile with the `UMB` extension and native-host bootstrap already registered.
2. Confirm the task is `browser-required`, not merely `static-capable`.
3. Prefer UMB whenever a task depends on:
   - the user's existing Chrome profile
   - logged-in state
   - existing user tabs
   - background access to non-active tabs
   - live DOM interaction
4. Read the relevant reference files when the task shape is unclear.

## Routing Rule

Treat a task as `browser-required` if any of these are true:

- the user explicitly asks to use their browser
- the target relies on an existing session or login
- the task requires inspecting or controlling an already open tab
- the site is JS-heavy or likely to block non-browser requests
- the task depends on browser-only state or real rendering

Treat a task as `static-capable` only when the answer can be retrieved reliably without the live browser and without losing correctness.

If the task is `browser-required`, do not silently fall back to plain HTTP or search-only strategies.
If the `UMB` bridge is unavailable, stop early and say that the live bridge is missing instead of pretending the task can be done through an active-tab-only workaround.

## UMB Workflow

1. Create or reuse a UMB session.
2. Enumerate tabs first.
3. Claim an existing tab when the user already has the target open.
4. Create a new background tab only when needed.
5. Use DOM snapshots before actions whenever locator truth is uncertain.
6. Prefer background-safe reads when possible.
7. Keep tab sprawl small and finalize the session cleanly.

## Safety Rules

- Never read cookies, local storage, saved passwords, or session stores directly.
- Ask before side effects such as sending messages, form submissions, purchases, or permission grants.
- Treat CAPTCHA, login continuation, and payment continuation as handoff points unless the user explicitly asked to proceed.
- Call out that UMB can inspect non-active tabs, which is a core advantage over active-tab-only browser skills.

## References

- For general operating discipline: `references/browser-playbook.md`
- For browser-required vs static-capable decisions: `references/browser-capability-matrix.md`
- For anti-bot and auth friction: `references/anti-automation-friction.md`
- For domain-specific learnings: `references/site-patterns/`
