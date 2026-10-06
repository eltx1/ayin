import type { AnchorHTMLAttributes } from "react";

// Browser component harness only. No application route or consent test hook is installed.
export function usePathname() {
  return window.location.pathname;
}
export default function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} />;
}
