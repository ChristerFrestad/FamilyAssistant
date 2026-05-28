---
name: Bug report
about: Report a problem you ran into while running FamilyAssistant
title: 'bug: <one-line summary>'
labels: bug
assignees: ''
---

## What happened

<!-- Symptom in plain English. -->

## What you expected

<!-- The behavior you were anticipating. -->

## How to reproduce

1.
2.
3.

## Environment

- **Deploy mode**: Docker / Portainer / bare-metal systemd / dev
- **Host**: Raspberry Pi 5 / Linux x86_64 / macOS / Windows / other
- **FamilyAssistant version**: <output of `git rev-parse HEAD` or the docker image tag>
- **Node.js version** (bare-metal only): <output of `node -v`>

## Logs

<!--
Paste relevant output. Helpful sources:
- `journalctl -u familieassistenten -n 100 --no-pager` (systemd)
- `docker compose logs --tail 100 app` (Docker)
- Browser DevTools Console for frontend issues

Scrub `AUTH_TOKEN`, `SESSION_SECRET`, API keys, and any personal data
before pasting.
-->

```
<paste here>
```

## Additional context

<!-- Anything else: screenshots, related issues, hypotheses. -->
