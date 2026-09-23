# Samsung Tizen and LG webOS TV packages

Task 38 keeps AYIN's TV business UI in the shared web application and adds platform packaging plus a thin runtime adapter. It does not fork product logic.

## Samsung Tizen

Task 78 defines the detailed baseline in `docs/TIZEN_CERTIFICATION.md`.

The current package remains a hosted Tizen Web application with `required_version="9.0"`. That is a manifest compatibility declaration, not a claim that Tizen 6.0–10.0 retail models have been runtime-certified.

`platforms/tizen/config.xml` declares the Samsung TV profile, packaged icon, 1920×1080 TV feature, HTTPS-only AYIN origins, Internet privilege, and remote-first pointing-device settings. The local packaged entrypoint uses `platforms/tizen/bootstrap.js` only to handle startup/offline retry and then opens the canonical hosted AYIN UI.

Samsung's current Hosted Applications policy requires advance Content Manager approval and does not expose Tizen APIs inside hosted content. The package therefore does not claim TVInputDevice, Application, AppCommon, adinfo/TIFA, AVPlay, emulator verification, physical-TV verification, Seller Office submission, or approval.

Remote/focus/media/product behavior remains in AYIN's shared web runtime. See `docs/TIZEN_CERTIFICATION.md` for exact verified/unverified stages and release blockers.

## LG webOS

`platforms/webos/appinfo.json` contains the required web app identity/version/main/title metadata and the hosted entry point is `platforms/webos/index.html`. Final `icon.png` and `largeIcon.png` are release-brand assets and must be supplied before packaging/submission. Package with the current webOS TV CLI/VS Code tooling and sign/deploy according to the target environment.

## Shared runtime

`apps/web/src/lib/tv-platform-runtime.ts` detects Tizen or webOS, maps D-pad/select/back/media keys into AYIN's existing `ayin:native-remote` event contract, emits pause/resume/relaunch lifecycle events, and registers Samsung media keys when the API exists. Unsupported keys are non-fatal.

The runtime is installed once from the root layout through `TvPlatformRuntime`. This keeps navigation/player code shared across browser, Android shells, Tizen, and webOS.

## Compatibility policy

Repository-side compatibility target:

- Samsung Tizen 9.0+ as the manifest-declared package range, pending emulator/device verification;
- current supported LG webOS TV web-app runtimes capable of hosted web applications and standard keyboard/remote events.

Exact retail-model/year coverage cannot be certified from repository CI. Before release, record the tested Samsung model/Tizen versions and LG model/webOS versions in the release checklist. Validate HLS/MP4 playback, fullscreen behavior, D-pad traversal, back/exit semantics, app suspend/resume, cookies/session persistence, CSP/network access, captions, and Google IMA behavior on each target runtime.

## External prerequisites remaining

Repository work does not claim the following live checks are complete:

- Samsung certificate/profile and Seller Office submission;
- LG developer/store signing/submission credentials;
- final launcher/store artwork;
- emulator and physical-TV validation matrix;
- target-runtime Google IMA/ad behavior;
- DRM/HLS codec compatibility on chosen retail models.

These are release-environment checks, not missing application architecture.
