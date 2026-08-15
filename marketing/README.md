# Hverdagsplanleggeren marketing

Static, crawlable site on the **same origin** as the app. Served
only when `Host` is in `MARKETING_HOSTS`. `/login` and `/dashboard`
stay the SPA. Public hostnames come from `MARKETING_CANONICAL` at
serve time (`{{CANONICAL}}` in these files).

5-second sentence: **ett sted for middag, gjøremål, kjøkkenet og handlelisten.**

```
npm run build:marketing   # copies into public/www + fonts/screens
```

The server falls back to this folder if `public/www` is missing.
