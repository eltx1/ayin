import type { ComponentPropsWithoutRef } from "react";

export type ButtonProperties = ComponentPropsWithoutRef<"button">;

export function Button({ children, type = "button", ...properties }: ButtonProperties) {
  return (
    <button type={type} {...properties}>
      {children}
    </button>
  );
}
