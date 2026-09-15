# AYIN localization foundation

AYIN uses one shared App Router page implementation per route. English is the complete baseline locale and keeps canonical, unprefixed URLs (for example `/movies`). Non-default locales use a leading locale segment (for example `/ar/movies`) that the Next.js proxy rewrites to the same underlying route.

## Invariants

- `en` is the fallback for unsupported locales and missing translation keys.
- Locale resolution priority is explicit URL prefix, persisted `ayin_locale` cookie, `Accept-Language`, then English.
- `?lang=<locale>` is the explicit locale-switch contract. The proxy persists the choice and redirects to the canonical locale-aware URL.
- Translation keys are typed from the English resource. Other locale resources are intentionally partial and fall back per key.
- User-generated titles, descriptions, channel names, comments and other user content are not passed through the UI translator.
- The application API remains locale-neutral. The web proxy bypasses `/api`; localized API fields should be introduced only by an explicit API contract.
- Locale metadata includes text direction so future RTL locales do not require page forks.
- SEO uses one canonical URL per locale plus `hreflang` and `x-default`. English canonical URLs stay unprefixed.
- Sitemaps advertise localized alternates only after a public route has meaningful localized UI. Add that route to the localized set instead of cloning its page.
- Use `formatDate` and `formatNumber` for locale-aware presentation rather than hand-formatted strings.

## Adding a locale

1. Add the locale to `supportedLocales` with its direction and Intl locale.
2. Add a partial resource file keyed by the English translation keys.
3. Register the resource in the translator.
4. Add meaningful public route translations before advertising them in hreflang/sitemaps.

This foundation intentionally does not attempt to translate the full product in Task 59.
