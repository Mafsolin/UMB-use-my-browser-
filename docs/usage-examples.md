# UMB Usage Examples

## Example Goals

- list browser tabs
- create a background tab
- navigate without stealing focus
- inspect DOM from a non-active tab
- use the built-in local interaction test page
- finalize browser work and keep only a handoff tab
- bootstrap the extension from the current Chromium-family profile through the local native host

## Example MCP-style actions

- `create_session`
- `open_tabs`
- `claim_tab`
- `new_tab`
- `goto`
- `get_url`
- `get_title`
- `dom_snapshot`
- `click`
- `fill`
- `scroll`
- `screenshot`
- `name_session`
- `finalize`

## Typical session flow

1. `create_session`
2. `open_tabs`
3. `claim_tab` for an existing tab or `new_tab`
4. `goto`
5. `dom_snapshot`
6. `click` / `fill` / `scroll`
7. `screenshot`
8. `name_session`
9. `finalize`

## Browser-Only Usage

For browser-required tasks, use UMB through the user's real browser only. Do not replace the live bridge with HTTP, search, static fetches, another browser, or active-tab-only tooling; report the browser-only path as blocked when UMB is unavailable.

## Live acceptance targets

- Read-only smoke target:

```text
https://www.google.com/search?q=weather
```

- Safe local interaction target:

```text
http://127.0.0.1:44777/umb-test-page
```

## Runtime notes

- `claimTab` may return `Another debugger is already attached ...` when another browser tool or debugger already owns that tab.
- `data:` navigation is not a required Comet acceptance path for UMB v1. Use the local UMB test page for interaction checks instead.
- The live bridge relies on localhost bootstrap plus bearer-token and Origin validation, not on a literal WebSocket `Authorization` header.

## Skill usage

Use the skill name:

```text
$use-my-browser
```

Human-facing display name:

```text
UMB
```
