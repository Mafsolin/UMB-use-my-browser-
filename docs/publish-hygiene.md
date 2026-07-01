# UMB Publish Hygiene

Use this checklist before calling the repository publish-ready.

## Repo files

- `LICENSE` exists in the repository root.
- `.github/workflows/ci.yml` exists in `main`.
- `README.md` mentions the bridge auth model, MIT license, and CI gates.

## GitHub repository metadata

- repository description is non-empty
- topics are set and product-relevant
- license is recognized by GitHub
- homepage may stay empty until a real project URL exists

Recommended metadata baseline:

- description: `Local Chromium browser bridge for MCP and CLI automation`
- topics:
  - `mcp`
  - `browser-automation`
  - `chromium-extension`
  - `native-messaging`
  - `typescript`
  - `windows`

## Security documentation

- docs describe the bootstrap flow as `extension -> native host -> localhost auth bootstrap -> WS bridge`
- docs explain that the bridge uses:
  - ephemeral bearer token
  - exact `chrome-extension://<id>/` origin binding in the production bootstrap path
  - localhost-only auth bootstrap
- docs explicitly note that a literal `Authorization` header is not used because of browser WebSocket API constraints

## Verification commands

```powershell
pnpm lint
gh repo view Mafsolin/UMB-use-my-browser- --json description,homepageUrl,repositoryTopics,licenseInfo
gh api repos/Mafsolin/UMB-use-my-browser-/contents/LICENSE?ref=main --jq .path
gh api repos/Mafsolin/UMB-use-my-browser-/contents/.github/workflows/ci.yml?ref=main --jq .path
```
