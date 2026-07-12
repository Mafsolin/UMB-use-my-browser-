# Security Policy

## Supported version

UMB is currently developed from the `main` branch. Security fixes are applied to the latest source revision; older snapshots are not maintained as separate supported releases.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability that could expose browser data, bypass session permissions, impersonate the extension bridge, or execute unintended browser actions.

Use GitHub's private vulnerability reporting for this repository when available. Include:

- affected commit and operating system
- browser and extension version
- minimal reproduction steps
- expected and actual behavior
- potential impact
- logs with tokens, session identifiers, URLs, and personal data removed

If private reporting is unavailable, contact the repository owner through the contact method shown on the GitHub profile and ask for a private disclosure channel before sending technical details.

## Security boundaries

UMB is designed as a local bridge:

- the daemon binds to `127.0.0.1`
- the extension WebSocket requires an ephemeral bearer subprotocol and an allowed extension Origin
- sessions explicitly control navigation, typing, and external side effects
- page reads redact configured sensitive fields before returning content

Local software running as the same user is not fully isolated from every localhost control surface. Do not run untrusted local programs while granting UMB sessions permission to type or perform external side effects.

## Sensitive reports

Never include real cookies, passwords, payment data, API keys, browser profile files, audit logs, or complete page captures in a report. Replace them with synthetic test data.
