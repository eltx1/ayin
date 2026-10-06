# Synthetic Clips media fixture

`clips-viewport.webm` is a locally generated 30-second VP8 test pattern at
96 × 160 pixels. It contains no customer or provider media. Native Chromium
layout tests serve these bytes through a test-only route and verify real decoded
frames, media events, and native controls without replacing media prototypes.

The route deliberately supplies `video/webm` for the synthetic canonical media
URL. This exercises native controls; it does not certify production MP4/HLS
encoding or an external media service.
