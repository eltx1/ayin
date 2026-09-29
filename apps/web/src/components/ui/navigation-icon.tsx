export type NavigationIconName = "home" | "browse" | "search" | "tv" | "library" | "menu";

export function NavigationIcon({ name }: { name: NavigationIconName }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      {name === "home" ? (
        <path d="M3.5 10.6 12 3.8l8.5 6.8v8.7a.9.9 0 0 1-.9.9h-5.1v-6.1h-5v6.1H4.4a.9.9 0 0 1-.9-.9z" />
      ) : null}
      {name === "browse" ? (
        <>
          <rect x="4" y="4" width="6" height="6" rx="1.5" />
          <rect x="14" y="4" width="6" height="6" rx="1.5" />
          <rect x="4" y="14" width="6" height="6" rx="1.5" />
          <rect x="14" y="14" width="6" height="6" rx="1.5" />
        </>
      ) : null}
      {name === "search" ? (
        <>
          <circle cx="10.8" cy="10.8" r="6.2" />
          <path d="m15.5 15.5 4.8 4.8" />
        </>
      ) : null}
      {name === "tv" ? (
        <>
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <path d="m8 2 4 4 4-4M8 22h8" />
        </>
      ) : null}
      {name === "library" ? (
        <>
          <path d="M4 5v15M8 3v17" />
          <rect x="12" y="5" width="8" height="15" rx="1.5" />
          <path d="m14.5 10 3 2-3 2z" />
        </>
      ) : null}
      {name === "menu" ? <path d="M4 7h16M4 12h16M4 17h16" /> : null}
    </svg>
  );
}
