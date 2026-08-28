import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button } from "./button.js";

describe("Button", () => {
  it("renders an accessible native button", () => {
    const markup = renderToStaticMarkup(<Button type="button">Continue</Button>);

    expect(markup).toContain("<button");
    expect(markup).toContain('type="button"');
    expect(markup).toContain("Continue");
  });
});
