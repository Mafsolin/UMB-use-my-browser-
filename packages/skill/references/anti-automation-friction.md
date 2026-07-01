# Anti-Automation Friction

Use UMB for:

- soft auth walls
- bot-challenged public sites
- session-sensitive dashboards
- sites that differ between static fetch and real browser render

When things fail:

1. Check whether the page actually rendered.
2. Check whether the tab is on the expected origin.
3. Snapshot before retrying actions.
4. Prefer a fresh focused state check over blind repeated clicks.
5. Escalate to user handoff if login, CAPTCHA, or permission consent is needed.
6. Prefer background-safe reads first, because UMB can inspect non-active tabs before deciding whether focus is necessary.
