# Samsung Tizen and LG webOS TV packages

Task 38 established thin TV packaging around AYIN's shared Web product. Task 78 hardens the Samsung Tizen baseline without forking product UI or player business logic.

## Samsung Tizen

The current Samsung package is a **hosted/cloud Web application**.

`platforms/tizen/index.html` and `bootstrap.js` are local compatibility/startup code only. The package declares Tizen 9.0 as its minimum runtime, and the local bootstrap navigates the top-level document to:

`https://ayin.stream/?platform=tizen&hosted=1`

AYIN does not use a remote iframe because Samsung documents that remote iframe content is not a supported interactive replacement for TV app UI.

Samsung also documents that hosted content does not have access to Tizen APIs. Task 78 therefore confines Tizen API usage to the local packaged bootstrap: it requests TVInputDevice, filters the optional media keys reported by the TV, registers them before top-level hosted navigation, and then treats the hosted AYIN page as capability-limited. Repository CI validates the bootstrap logic, but persistence of those media-key registrations after hosted navigation remains emulator/device verification.

The detailed Task 78 support and certification state is in `docs/TIZEN_CERTIFICATION.md`.

## LG webOS

`platforms/webos/appinfo.json` contains the existing Web app identity/version/main/title metadata and `platforms/webos/index.html` remains the hosted Web entry point.

Task 78 does not alter or recertify webOS.

## Shared runtime

`apps/web/src/lib/tv-platform-runtime.ts` remains the common TV adapter.

It:

- recognizes Samsung hosted runtime from the official Tizen user-agent shape even when Tizen APIs are absent;
- maps standard DPAD/Enter/Back keyboard events into AYIN's existing remote contract;
- recognizes the packaged media-key registration path while remaining safe when hosted content has no Tizen API object;
- reuses AYIN's shared focus and player controls;
- maps visibility/pagehide lifecycle without creating platform-specific product UI;
- shows the shared hosted-Tizen network-loss notice from standard browser online/offline state, while physical network recovery remains a device acceptance item.

## Compatibility policy

Task 78 declares Samsung Tizen **9.0 and 10.0** as the current AYIN Web baseline.

Tizen 8.0 and older are not claimed because their documented Web engines fall below the current Next.js 16 default Chrome baseline.

Samsung Simulator/Emulator, physical-TV verification and Seller Office status remain explicitly separate stages. None is implied by repository CI.
