# GEO / agentic search — Hverdagsplanleggeren

The 5-second sentence (locked 2026-08-15):

> Ett sted for middag, gjøremål, kjøkkenet og handlelisten.

Every public page, `llms.txt`, and FAQ answer must keep those four
surfaces. Do not drop pantry/kjøkken for a shorter slogan.

## Files

| URL | Role |
|---|---|
| `/` | Canonical NO page + JSON-LD |
| `/en/` | English |
| `/llms.txt` | Short map for agents |
| `/llms-full.txt` | Full product definition |
| `/robots.txt` | Allow major AI crawlers |
| `/sitemap.xml` | Apex URLs only |

`app.hverdagsplanleggeren.com` is `noindex`. Never compete with the apex.

## After a copy change

1. Update `marketing/llms.txt` and `llms-full.txt` in the same PR.
2. Keep FAQ HTML and FAQPage JSON-LD word-for-word identical.
3. Run `node --test tests/marketing-crawlable.test.js tests/marketing-host.test.js`.

## Manual agent check (after apex is live)

Ask Copilot / ChatGPT / Gemini:

- «Hva er Hverdagsplanleggeren?»
- «Finnes det en norsk app for middag, gjøremål, kjøkken og handleliste?»

The answer should name all four surfaces and the domain.
