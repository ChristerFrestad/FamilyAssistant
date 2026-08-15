# Hverdagsplanleggeren marketing

Static, crawlable site on the **same origin** as the app
(`hverdagsplanleggeren.com/`, not `app.`). Served only when `Host` is
in `MARKETING_HOSTS`. `/login` and `/dashboard` stay the SPA.

5-second sentence: **ett sted for middag, gjøremål, kjøkkenet og handlelisten.**

```
npm run build:marketing   # copies into public/www + fonts/screens
```

The server falls back to this folder if `public/www` is missing.
