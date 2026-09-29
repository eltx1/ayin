import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ActionButton,
  ActionLink,
  DataBadge,
  MetricList,
  PageHeader,
  SelectField,
  StatusNotice,
  TextField,
} from "./design-system";

describe("shared design semantics", () => {
  it("uses a non-submit default and native pending/disabled behavior without losing its name", () => {
    const html = renderToStaticMarkup(<ActionButton pending>Save changes</ActionButton>);
    expect(html).toContain('type="button"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("Save changes");
    expect(html).not.toContain("pending=");
    expect(renderToStaticMarkup(<ActionButton type="submit">Publish</ActionButton>)).toContain(
      'type="submit"',
    );
    expect(
      renderToStaticMarkup(
        <ActionButton disabled tone="danger">
          Delete
        </ActionButton>,
      ),
    ).toContain('disabled=""');
  });
  it("keeps links as links and page headers out of main landmark ownership", () => {
    const html = renderToStaticMarkup(
      <PageHeader
        title="الأفلام"
        description="اكتشف محتوى جديدًا"
        actions={<ActionLink href="/ar/search">بحث</ActionLink>}
      >
        <nav aria-label="Categories" />
      </PageHeader>,
    );
    expect(html).toContain("<h1");
    expect(html).toContain('href="/ar/search"');
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain("<main");
    expect(html).not.toContain("<button");
    const nested = renderToStaticMarkup(<PageHeader level={2} title="Recent videos" />);
    expect(nested).toContain("<h2");
    expect(nested).not.toContain("<h1");
  });
  it("never invents metric values and keeps zero, unavailable and labels distinguishable", () => {
    const html = renderToStaticMarkup(
      <MetricList
        label="Counters"
        items={[
          { label: "Uploads", value: 0 },
          { label: "Revenue", value: "Unavailable", detail: "No report received" },
        ]}
      />,
    );
    expect(html).toContain("<dl");
    expect(html).toContain('<dt dir="auto">Uploads</dt>');
    expect(html).toContain('<dd dir="auto">0</dd>');
    expect(html).toContain("Unavailable");
    expect(html).toContain("No report received");
    expect(html).not.toContain("0.00");
  });
  it("announces messages only explicitly and keeps semantic status text, not color alone", () => {
    expect(renderToStaticMarkup(<StatusNotice>Ready</StatusNotice>)).not.toContain("role=");
    expect(renderToStaticMarkup(<StatusNotice announce="polite">Saved</StatusNotice>)).toContain(
      'role="status"',
    );
    expect(
      renderToStaticMarkup(
        <StatusNotice announce="assertive" tone="danger">
          Could not save
        </StatusNotice>,
      ),
    ).toContain('role="alert"');
    const badge = renderToStaticMarkup(<DataBadge tone="warning">Awaiting review</DataBadge>);
    expect(badge).toContain("Awaiting review");
    expect(badge).not.toContain('role="status"');
  });
  it("connects field labels, native constraints, help and errors without discarding caller descriptions", () => {
    const html = renderToStaticMarkup(
      <TextField
        id="title"
        name="title"
        label="Video title"
        hint="Visible to viewers"
        error="Enter a title"
        aria-describedby="external-help"
        required
        maxLength={160}
      />,
    );
    expect(html).toContain('for="title"');
    expect(html).toContain('id="title"');
    expect(html).toContain('required=""');
    expect(html).toContain('maxLength="160"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="title-hint title-error external-help"');
    expect(html).toContain('id="title-error"');
    expect(html).toContain('id="title-hint"');
    expect(html).not.toContain('role="alert"');
    const select = renderToStaticMarkup(
      <SelectField id="visibility" label="Visibility" name="visibility" disabled>
        <option value="PRIVATE">Private</option>
      </SelectField>,
    );
    expect(select).toContain('for="visibility"');
    expect(select).toContain('disabled=""');
    expect(select).toContain('value="PRIVATE"');
    expect(select).not.toContain("aria-describedby");
  });
});
