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
