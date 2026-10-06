# Clips native controls and viewport evidence

## Why the earlier captures were insufficient

The progress follow-on at `32af3b5efa785611dbcc807243c606f74afdeb6d`
retained the prior Clips layout. Its EN/AR full-page images were not viewport
acceptance evidence: sticky/fixed chrome appeared in document coordinates and
synthetic media had not decoded. Those originals remain preserved.

A separate inspection used genuinely decoded local WebM and ordinary viewport
screenshots. Chromium's user-agent shadow-tree boxes confirmed real overlap:

- At EN 1440 × 900, the Share button covered the native fullscreen target.
- At AR 390 × 844, Share covered the native play target.
- Metadata shared the native controls' bottom strip.
- Keyboard `scrollIntoView({ block: "start" })` moved the feed underneath the
  sticky header. A feed could be manually centered, but that did not verify the
  product's keyboard navigation.

The initial corrected diagnostic still captured some inner feed scrolling in
progress. Its arrow images are retained as intermediate evidence and are not
used for final keyboard acceptance.

## Correction

The article now has separate media and metadata grid rows. Native controls stay
inside the video. Channel/title/description and social actions occupy a static
panel below it, with no browser-specific native-control height offset.

Independent source review identified valid long descriptions as an edge case.
The metadata track is capped at 45% of the article and scrolls its complete
content; it cannot collapse the media row. Content starts at the panel's top,
so oversized descriptions do not become unreachable above the scroll origin.

Keyboard navigation scrolls the feed internally to the selected article and
centers the feed within measured shell-header and fixed-mobile-navigation
bounds. It preserves reduced-motion behavior and verifies smooth navigation
separately. The accepted ClipVideo and shared progress hook are unchanged.

## Native validation

Four Chromium cases cover EN and AR at both 1440 × 900 and 390 × 844. Each uses
real synthetic authentication, API handlers and disposable PostgreSQL, and a
locally generated WebM fixture. No media methods, properties or events are
replaced in these layout cases.

The assertions require:

- Decoded frames, paused ready media, and no media error.
- The selected article and feed within the usable viewport after the product's
  ArrowDown/ArrowUp handling, without a later scroll correction.
- Custom controls inside the article and usable viewport, with real hit tests
  and minimum 44-pixel button targets.
- Exactly one rendered native play, seek and fullscreen control, measured
  through Chromium's user-agent shadow tree; no intersection with the metadata
  panel or its controls.
- Actual mouse play/pause, scrubber seeking, fullscreen entry and fullscreen
  exit through those native targets.
- EN mobile smooth navigation and AR mobile reading of a valid 20,000-character
  description by mouse wheel, including its final character, while the document,
  feed and video positions stay unchanged.

The matrix's settled and keyboard viewport PNGs are the authoritative originals.
The existing social/pagination test also uses decoded paused viewport captures
and records custom-control bounds; those captures deliberately center the active
clip and do not substitute for the matrix's uncorrected keyboard checks.

The first matrix attempt encountered hidden duplicate UA controls with no box
model. The observer now records those specific non-rendered candidates while
still requiring exactly one real target for every requested native control.
Other inspection errors remain failures. No application change was needed for
that observer correction.

## Wrapped channel links and retrievable CI evidence

PR #256's mobile EN/AR cases failed the channel-link hit assertion while the
same desktop cases passed. The observer sampled the vertical midpoint of
`getBoundingClientRect()`, which is a union of every inline fragment. A wrapped
link can have a line gap at that midpoint; the metadata panel receives the
pointer there even though every rendered part of the link is unobstructed.

A local probe seeded the exact two reported handles as real channel records:
`clips-viewer-muwa5r8w-ew4c00` and `clips-viewer-muwa5y7f-cj2qg0`. With a
process-local DejaVu font environment, CDP identified DejaVu Sans Bold at the
application's existing 15px size and 22.5px line height. Both handles wrapped
onto two lines with three client fragments. All three original union samples
hit the panel between the lines; all nine fragment samples hit the link. The
original assertion failed for both handles. Real mouse clicks on every fragment
navigated to the corresponding channel. Native video actions still worked, and
a temporary negative-control occluder caused the fragment assertion to fail.

This is a controlled-font reproduction of the failure mechanism, not proof of
CI's exact font environment. The default cloud font substitution and a broader
local Linux font set kept these handles on one line. The combined CI artifact
was returned by the GitHub artifact connector, but its 64,732,451-byte size exceeded
the executor transfer limit. The separately returned signed download URL gave 403. Its screenshots were not independently inspected.

The native-layout observer and the viewer/social screenshot helper now sample
all positive `getClientRects()` fragments and require nonempty hit targets. The
preservation run exposed the same union-box defect in the viewer helper after
all 20 progress, 16 social-scope and four native-layout cases had passed. Union-box containment, minimum button size, native-control
separation, and every per-point occlusion assertion remain in place. No product
markup, styling, media, social or progress implementation changed. The matrix's
reduced-motion setting also now uses Playwright's supported `contextOptions`,
with explicit media-query assertions before reduced and smooth navigation.

Bounds and native mouse-action evidence are written as per-test JSON files, and
original viewport PNGs have a common `clips-layout-` prefix. CI always attempts a
separate `clips-layout-evidence` upload containing those JSON/PNG files and any
layout-test failure screenshot/context. It excludes recordings, traces and the
full HTML report; the existing full failure report remains available separately.
If no layout evidence was produced, the upload ignores missing files without
changing the acceptance result. The final focused replay passed all four native
layout cases and the viewer/social pagination case. The earlier 40-pass/one-fail
preservation run is retained separately; it supplies the 20 progress and 16
social-scope passes and is not described as a clean combined run. The focused
layout artifact contains 16 original PNGs and 21 JSON files, about 1.5 MB before
compression in the local replay.

## Progress preservation and CI observation

The layout work leaves the accepted identity, revision and lifecycle code
unchanged. The owning run includes all 20 Clips progress cases plus the existing
EN/AR social/pagination case.

A Clips before-commit regression encountered Chromium's transient
`Network.getResponseBody` eviction. Its correction verifies GET 200 and exactly
one refresh, retains the winning progress/history assertions before any new
intent, then proves a new explicit rewind PUT carries the winning revision and
saves successfully. It does not retry or ignore arbitrary response-body errors.
The equivalent parent-supplied Watch observation correction is included unchanged
and passed three explicitly requested isolated repeats.

## Limits and retained evidence

These are Chromium synthetic-media and layout checks, including desktop Chrome
resized to mobile widths. They do not certify a physical device, Safari/WebKit,
or production MP4/HLS/provider behavior. The page's title and feed remain
ordinary scrollable document content; a full feed is not claimed to fit alongside
all introductory content in the initial unscrolled viewport.

Raw failing originals, intermediate diagnostics, final viewport originals,
DOM/CDP bounds, native mouse-action proofs, source hashes, review and shutdown
reports are retained in the external Clips viewport evidence bundle. Exact
owning counts and commit/tree identities are recorded in its source manifest.
