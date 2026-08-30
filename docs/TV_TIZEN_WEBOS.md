# Samsung Tizen and LG webOS TV packages

Task 38 keeps AYIN's TV business UI in the shared web application and adds platform packaging plus a thin runtime adapter. It does not fork product logic.

## Samsung Tizen

`platforms/tizen/config.xml` is the TV Web Application manifest and `platforms/tizen/index.html` is the hosted entry point. The package permits only AYIN web/API origins, declares TV input access, launches maximized in landscape, and relies on the shared `tv-platform-runtime` to register supported media keys and normalize remote input.

The repository intentionally does not contain a production Samsung certificate/profile or final store artwork. Before creating a `.wgt` release, provide the final icon assets, create the Samsung certificate profile in Tizen Studio, validate the current target-TV minimum Tizen version, run on the Samsung TV simulator/emulator, then run on representative physical models. Do not commit author/distributor certificates or signing passwords.

## LG webOS

`platforms/webos/appinfo.json` contains the required web app identity/version/main/title metadata and the hosted entry point is `platforms/webos/index.html`. Final `icon.png` and `largeIcon.png` are release-brand assets and must be supplied before packaging/submission. Package with the current webOS TV CLI/VS Code tooling and sign/deploy according to the target environment.

## Shared runtime

`apps/web/src/lib/tv-platform-runtime.ts` detects Tizen or webOS, maps D-pad/select/back/media keys into AYIN's existing `ayin:native-remote` event contract, emits pause/resume/relaunch lifecycle events, and registers Samsung media keys when the API exists. Unsupported keys are non-fatal.

The runtime is installed once from the root layout through `TvPlatformRuntime`. This keeps navigation/player code shared across browser, Android shells, Tizen, and webOS.

## Compatibility policy

Repository-side compatibility target:

- modern Samsung Smart TV Tizen Web Application runtimes that support the declared TV profile and HTML5 media stack;
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
