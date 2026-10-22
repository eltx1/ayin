# Native telemetry and bridge contract, version 1

The implementation authorities are `apps/web/src/lib/mobile-bridge.ts`, Android `MobileConfig.kt`, and iOS `MobileContract.swift`. All three validate inputs. The full configuration fixture is `MOBILE_RUNTIME_CONTRACT.json`. Unknown fields/types/events are rejected by native code; web capability detection keeps ordinary browsers and older shells usable.

`window.AyinMobile` exposes `version:1`, `capabilities:string[]`, and only `request({id,method,params})`. Replies arrive as `ayin:mobile-response` with the same ID and `ok/result/error`; unsolicited events use `ayin:mobile-event`. Requests have bounded timeouts and are canceled on page exit. No file, reflection, arbitrary invocation or eval method exists. Native message handlers require the trusted HTTPS top frame.

| Method                                         | Parameters / purpose                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `runtime.configure`                            | `{config}`; strict schema 1, returns platform, app version, installation, current account binding, eligibility and configured SDK flags |
| `privacy.request`, `privacy.options`           | `{underAgeOfConsent:boolean}` or `{}`; UMP consent and privacy options                                                                  |
| `analytics.consent`, `analytics.user`          | `{enabled:boolean}` or `{id:opaqueId or null}`; explicit collection/identity control                                                    |
| `analytics.event`                              | `{name,params}` from the finite schema below                                                                                            |
| `ads.banner`, `ads.hideBanner`                 | `{placement}` or `{}`; actual native adaptive banner                                                                                    |
| `ads.interstitial`                             | `{placement,naturalTransition:true}`; preload/ready/show state, no automatic late presentation                                          |
| `notifications.request`, `notifications.token` | `{accountId:UUID}`; explicit permission and FCM token, never APNs bytes                                                                 |
| `session.reset`                                | `{}`; invalidate ads/telemetry/push state and async callbacks on logout/switch                                                          |

## Web-originated native events

| Event                                                 | Allowed parameters                                                  | Meaning                                                                                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `screen_view`                                         | `screen_name`: home/watch/clips/search/channel/account/upload/other | One route-level screen event after identity reconciliation. Automatic native screen reporting is disabled.                                   |
| `video_start`, `video_complete`                       | `content_type:video`                                                | Existing content player's start/completion lifecycle.                                                                                        |
| `video_progress`                                      | `content_type:video`, `position_seconds` finite 0–86400             | Existing player's bounded progress checkpoints; not every timeupdate.                                                                        |
| `clip_view`                                           | `content_type:clip`                                                 | Once per mounted Clip after at least two accumulated seconds of active, visible, uninterrupted playback progress; seeking gaps do not count. |
| `search`                                              | `query_length` 0–200                                                | Search activity without the query text.                                                                                                      |
| `follow`                                              | none                                                                | Existing successful subscribe action.                                                                                                        |
| `share`                                               | `content_type:video or clip`                                        | Existing share interaction; no recipient or shared URL.                                                                                      |
| `upload_started`, `upload_completed`, `upload_failed` | `size_bucket:small, medium, large or unknown`                       | Foreground upload lifecycle. No filename, URI, title or free-text error.                                                                     |
| `upload_resumed`                                      | `size_bucket:unknown`                                               | Resumed multipart transfer with previously completed parts.                                                                                  |

The existing AYIN first-party product analytics pipeline remains separate. No Firebase web analytics SDK is added. In a native host, this adapter sends one native Firebase call for each accepted event; SDK-owned `ad_impression`/revenue are never mirrored manually. The current wire schemas use far fewer than Firebase's parameter limits and reserve no caller-defined event names.

Native ad callbacks emit consent-gated `ad_request`, `ad_loaded`, `ad_failed` with bounded diagnostic codes/format/placement. Estimated paid-event callbacks retain currency/precision and deduplicate responses; they are not final publisher earnings or writes to the financial ledger.

Android records `notification_received` / `notification_opened` when its app callback runs. iOS uses `ayin_notification_receive` / `ayin_notification_open`, with duplicate-ID suppression and no event parameters; receive means foreground presentation callback, not an inference that the OS delivered a background alert. iOS app-delegate swizzling is disabled. Do not aggregate these callback observations as guaranteed notification delivery.

## Consent and validation evidence

Remote enablement, native capability/configuration, audience/profile eligibility and explicit collection consent must all pass. An opaque internal account UUID is allowed only with consent; logout, account switch and consent revocation clear it. No email, account display name, search text, message text, session token, FCM token, file URL or arbitrary crash log crosses the analytics schema.

Automated contract tests prove validation and dispatch behavior, not arrival at Firebase. The release gate is a configured physical-device DebugView session demonstrating one event with permitted parameters, followed by logout/opt-out and no further attributed collection. Crashlytics requires its own controlled test crash and symbolication proof.
