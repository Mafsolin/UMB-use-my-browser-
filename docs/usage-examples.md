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

- `umb_create_session`
- `umb_open_tabs`
- `umb_claim_tab`
- `umb_new_tab`
- `umb_goto`
- `umb_get_url`
- `umb_get_title`
- `umb_dom_snapshot`
- `umb_click`
- `umb_fill`
- `umb_scroll`
- `umb_screenshot`
- `umb_name_session`
- `umb_finalize`

## Typical session flow

1. `umb_create_session`
2. `umb_open_tabs`
3. `umb_claim_tab` for an existing tab or `umb_new_tab`
4. `umb_goto`
5. `umb_dom_snapshot`
6. `umb_click` / `umb_fill` / `umb_scroll`
7. `umb_screenshot`
8. `umb_name_session`
9. `umb_finalize`

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

## Skill usage

Use the skill name:

```text
$use-my-browser
```

Human-facing display name:

```text
UMB
```
