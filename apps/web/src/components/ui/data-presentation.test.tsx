import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DataTable, Disclosure } from "./data-presentation";
import { FormSection, TextAreaField, TextField } from "./design-system";

describe("native data and form presentation", () => {
  it("keeps table caption and row/column scope with keyboard-local scrolling", () => {
    const html = renderToStaticMarkup(
      <DataTable
        caption="Recent conversations"
        rows={[{ id: "internal-id", author: "Reader <script>", likes: 0 }]}
        rowKey={(row) => row.id}
        columns={[
          { key: "author", heading: "Comment", rowHeader: true, render: (row) => row.author },
          { key: "likes", heading: "Likes", compact: true, render: (row) => row.likes },
        ]}
      />,
    );
    expect(html).toContain("<caption>Recent conversations</caption>");
    expect(html).toContain('role="region" aria-label="Recent conversations" tabindex="0"');
    expect(html).toContain('scope="col"');
    expect(html).toContain('<th scope="row">Reader &lt;script&gt;</th>');
    expect(html).toContain("<td>0</td>");
    expect(html).not.toContain("internal-id");
    expect(html).not.toContain('role="grid"');
    expect(html).not.toContain("<script>");
  });

  it("groups native disabled fields without creating a competing form or main landmark", () => {
    const html = renderToStaticMarkup(
      <FormSection
        id="request-fields"
        legend="Request details"
        description="Describe the issue"
        disabled
      >
        <TextField id="subject" label="Subject" required minLength={4} maxLength={200} />
        <TextAreaField
          id="details"
          label="Details"
          rows={6}
          required
          minLength={10}
          maxLength={20000}
          hint="Keep private credentials out"
          error="Add details"
          aria-describedby="other-help"
        />
      </FormSection>,
    );
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toContain("<legend>Request details</legend>");
    expect(html).toContain('aria-describedby="request-fields-description"');
    expect(html).toContain('for="details"');
    expect(html).toContain('aria-describedby="details-hint details-error other-help"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('minLength="10"');
    expect(html).toContain('maxLength="20000"');
    expect(html).toContain('rows="6"');
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<main");
  });

  it("uses native closed disclosure instead of manually synchronizing aria state", () => {
    const html = renderToStaticMarkup(
      <Disclosure summary="Additional options">
        <p>Priority</p>
      </Disclosure>,
    );
    expect(html).toContain("<summary>Additional options</summary>");
    expect(html).not.toContain(" open=");
    expect(html).not.toContain("aria-expanded");
    const open = renderToStaticMarkup(
      <Disclosure summary="Response" open>
        <p>Resolved</p>
      </Disclosure>,
    );
    expect(open).toContain('open=""');
  });
});
