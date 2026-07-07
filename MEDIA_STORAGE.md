# Media storage

The question database stores media paths as local paths, for example:

```text
/media/example.wmv
```

In local development, keep `MEDIA_BASE_URL` empty. The Express server will serve files from:

```text
public/media
```

For production, upload the contents of `public/media` to external storage/CDN and preserve the same file names. Then set:

```env
MEDIA_BASE_URL="https://media.zdajb.pl"
```

When `MEDIA_BASE_URL` is set, API responses automatically change:

```text
/media/example.wmv
```

into:

```text
https://media.zdajb.pl/example.wmv
```

Important deployment notes:

- The Vite build does not copy `public/media` into `dist`.
- `dist` contains only the app bundle and small public assets like favicon and preview image.
- Upload media separately before enabling production video questions.
- Keep `/media/*` out of service worker cache.
- If storage has private access rules, configure signed URLs before launch.

Quick check after deployment:

1. Open `/api/questions/random`.
2. Confirm video questions return a `mediaPath` starting with `https://media.zdajb.pl/`.
3. Open one returned media URL in the browser.
4. Confirm logged-out users cannot access premium video flows through the app.
