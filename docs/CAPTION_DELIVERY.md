# Watch caption delivery

Native WebVTT tracks must share the document origin unless the parent media element opts into CORS. The production Watch page previously attached `media.ayin.stream` tracks to a video without that opt-in: the language menu could select Arabic while the browser rejected the track and loaded no cues.

Watch now maps only the creator caption namespace
`captions/videos/{videoId}/{assetId}/track.vtt` to
`/api/captions/{videoId}/{assetId}`. Both identifiers must be canonical lowercase UUIDs. Legacy caption addresses retain their existing mapping. Video, HLS, player selection and IMA code are unchanged. In particular, the video element's CORS mode is unchanged, including when IMA uses that element for an ad.

The Next.js route reads the existing **public** caption object from the configured `NEXT_PUBLIC_MEDIA_BASE_URL`. The browser obtains the object key from the existing authorized playback response; this route does not replace or broaden that metadata read, enumerate objects, sign storage grants, or retrieve private R2 objects. It uses no provider credentials and forwards no viewer cookies, authorization, range or other request headers. Existing public CDN object accessibility is unchanged; the route is not a new access-control layer.

## Delivery bounds

- Accept only the exact caption key shape; no arbitrary URL, path or query target.
- Use the configured HTTPS media base; HTTP is accepted only for explicit localhost development/test origins.
- Reject redirects and responses other than a complete `200 text/vtt` object; preserve an upstream 404.
- Bound the entire upstream operation to ten seconds, including body reads, and abort on viewer disconnect.
- Bound actual received bytes to 2 MiB, matching the existing caption upload limit, regardless of the Content-Length header.
- Require UTF-8 text without null bytes and a valid WEBVTT header before returning it as `text/vtt; charset=utf-8` with `nosniff`.
- Use private/no-store responses and no persistent cache or filesystem storage. The existing service worker excludes `/api/` requests.

There are no new environment variables, migrations or bucket changes. Rebuild the web app with its normal media base configured. This narrowly transports caption text; creator upload bytes and video playback remain direct to the existing media infrastructure.

## Focused verification

```sh
pnpm --filter @ayin/types --filter @ayin/ui build
pnpm --filter @ayin/web exec vitest run src/lib/caption-delivery.test.ts 'src/app/api/captions/[videoId]/[assetId]/route.test.ts' 'src/app/(viewer)/watch/[slug]/page.test.tsx' src/components/player/ayin-player.test.tsx src/lib/google-ad-lifecycle.test.ts
pnpm exec playwright test --config playwright.caption-delivery.config.ts
```

The standalone browser case needs FFmpeg and Playwright Chromium, uses only localhost ports 3227/3228, and requires no database, account or production service. It starts the actual Next route and a separate synthetic media origin. The original cross-origin track fails even with a VTT CORS grant; the same-origin route produces a loaded, active Arabic cue and a screenshot while the cross-origin MP4 plays without a video CORS grant. Synthetic MP4 uses VP9 because bundled Chromium may omit H.264. This checks caption transport and native rendering, not production encoding or live ad fill.

After deployment, verify a real Watch track reaches `readyState=2`, loads the expected cues and displays Arabic at an actual cue time. A selected language alone is not completion evidence. Live/provider captions and other surfaces are outside this Watch repair.
