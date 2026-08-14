# Screenshots

Used by the root `README.md`. Keep file names stable so GitHub image URLs do not break.

| File | What it shows |
|---|---|
| `00-welcome.png` | Welcome / first run |
| `01-dashboard.png` | Signed-in home (English, light theme) |
| `02-meals-weekplan.png` | Weekly meal plan |
| `03-shopping-list.png` | Shopping list |
| `04-pantry.png` | Pantry inventory |
| `05-login.png` | Username/password sign-in |

All six README shots are captured from `_capture.html` in English, using the same cream / mint / Instrument Serif look as the app.

## Capture

```bash
# Welcome / login / dashboard (Chrome headless)
chrome --headless=new --hide-scrollbars --window-size=900,780 \
  --screenshot=docs/screenshots/00-welcome.png \
  file:///$PWD/docs/screenshots/_capture.html#welcome
```

Hashes on `_capture.html`: `#welcome`, `#login`, `#dashboard`.

Live screens (`02`–`04`): 1440×900, crop browser chrome, no real family names. Prefer the seeded recipes (Peder Ås / fixture data). Keep each PNG under ~200 KB.
