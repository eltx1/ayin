from pathlib import Path


def replace_once(path_name: str, old: str, new: str, label: str) -> None:
    path = Path(path_name)
    text = path.read_text()
    if old not in text:
        raise SystemExit(f"patch anchor not found: {label}")
    path.write_text(text.replace(old, new, 1))


replace_once(
    "apps/api/src/revenue/creator-finance.crypto.ts",
    '''  if (normalized.includes("@")) {
    const [local = "", domain = ""] = normalized.split("@", 2);
    const visible = local.slice(0, Math.min(2, local.length));
    return `${visible}${"•".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
  }
''',
    '''  const emailMatch = /^([^\\s@]+)@([^\\s@]+\\.[^\\s@]+)$/.exec(normalized);
  if (emailMatch) {
    const [, local = "", domain = ""] = emailMatch;
    const visible = local.slice(0, Math.min(2, local.length));
    return `${visible}${"•".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
  }
''',
    "payout destination full-email mask",
)

replace_once(
    "apps/api/src/revenue/creator-finance.crypto.test.ts",
    '''  it("returns masked display values instead of payout destinations", () => {
    expect(maskPayoutDestination("creator@example.com")).toBe("cr•••••@example.com");
    expect(maskPayoutDestination("GB12 AYIN 1234 5678 9012 34")).toBe("•••• 1234");
  });
''',
    '''  it("returns masked display values instead of payout destinations", () => {
    expect(maskPayoutDestination("creator@example.com")).toBe("cr•••••@example.com");
    expect(maskPayoutDestination("GB12 AYIN 1234 5678 9012 34")).toBe("•••• 1234");

    const freeForm = maskPayoutDestination("contact@example.com, account 00112233");
    expect(freeForm).toBe("•••• 2233");
    expect(freeForm).not.toContain("example.com");
    expect(freeForm).not.toContain("00112233");
  });
''',
    "payout destination mask regression",
)

replace_once(
    "apps/api/src/revenue/revenue.service.ts",
    '''  private async creatorChannel(accountId: string) {
    const membership = await this.database.client.channelMember.findFirst({
      where: {
        accountId,
        role: { in: ["OWNER", "ADMIN", "EDITOR"] },
        channel: { status: { not: "REMOVED" } },
      },
      orderBy: { createdAt: "asc" },
      select: { channel: { select: { id: true, name: true, handle: true } } },
    });
    return membership?.channel ?? null;
  }
''',
    '''  private async creatorChannel(accountId: string) {
    const membership = await this.database.client.channelMember.findFirst({
      where: {
        accountId,
        role: { in: ["OWNER", "ADMIN"] },
        channel: { status: { not: "REMOVED" } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { channel: { select: { id: true, name: true, handle: true } } },
    });
    return membership?.channel ?? null;
  }
''',
    "revenue finance channel selection",
)

for path_name in (
    "apps/api/src/revenue/creator-finance.service.ts",
    "apps/api/src/revenue/creator-monetization-analytics.service.ts",
):
    replace_once(
        path_name,
        '      orderBy: { createdAt: "asc" },\n',
        '      orderBy: [{ createdAt: "asc" }, { id: "asc" }],\n',
        f"deterministic creator channel selection in {path_name}",
    )

safe_csv_body = '''  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  const candidate = text.trimStart();
  const numericLiteral = /^-?\\d+(?:\\.\\d+)?$/.test(candidate);
  const formulaLeading =
    /^[\\t\\r\\n]/.test(text) ||
    /^[=+@]/.test(candidate) ||
    (candidate.startsWith("-") && !numericLiteral);
  const safeText = formulaLeading ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
'''

replace_once(
    "apps/api/src/admin/admin-governance.service.ts",
    '''  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  return `"${text.replaceAll('"', '""')}"`;
''',
    safe_csv_body,
    "admin CSV injection protection",
)

replace_once(
    "apps/api/src/revenue/creator-monetization-analytics.service.ts",
    '''  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  return `"${text.replaceAll('"', '""')}"`;
''',
    safe_csv_body,
    "creator statement CSV injection protection",
)

replace_once(
    "apps/api/test/payout-safety.integration.test.ts",
    '''  it("atomically snapshots creator payouts, keeps the snapshot immutable and never exposes ciphertext", async () => {
''',
    '''  it("uses one authorized channel consistently when an older editor membership also exists", async () => {
    const editorChannelOwner = await register("Editor Channel Owner", "editor-channel-owner@example.com");
    const creator = await register("Multi Channel Creator", "multi-channel-creator@example.com");

    await prisma.channelMember.create({
      data: {
        channelId: editorChannelOwner.user.channel.id,
        accountId: creator.user.account.id,
        role: "EDITOR",
        createdAt: new Date("2000-01-01T00:00:00.000Z"),
      },
    });
    await prisma.earningsLedgerEntry.createMany({
      data: [
        {
          channelId: editorChannelOwner.user.channel.id,
          type: "AD_REVENUE",
          state: "FINAL",
          amount: "999.000000",
          currency: "USD",
        },
        {
          channelId: creator.user.channel.id,
          type: "AD_REVENUE",
          state: "FINAL",
          amount: "125.000000",
          currency: "USD",
        },
      ],
    });

    const profile = await app.inject({
      method: "PUT",
      url: "/creator/studio/revenue/payment-profile",
      headers: { cookie: creator.cookie },
      payload: {
        legalName: "Multi Channel Creator",
        preferredCurrency: "USD",
        provider: "MANUAL",
        destination: "bank account ending 4321",
        countryCode: "US",
      },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().channelId).toBe(creator.user.channel.id);

    const overview = await app.inject({
      method: "GET",
      url: "/creator/studio/revenue",
      headers: { cookie: creator.cookie },
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({
      channel: { id: creator.user.channel.id },
      currency: "USD",
      finalizedRevenue: "125.000000",
      availableForPayout: "125.000000",
      paymentProfile: { channelId: creator.user.channel.id },
    });

    const requested = await app.inject({
      method: "POST",
      url: "/creator/studio/revenue/payout-requests",
      headers: { cookie: creator.cookie },
      payload: { currency: "USD" },
    });
    expect(requested.statusCode).toBe(201);
    expect(requested.json().payout.channelId).toBe(creator.user.channel.id);
    expect(
      await prisma.payout.count({ where: { channelId: editorChannelOwner.user.channel.id } }),
    ).toBe(0);
  });

  it("neutralizes formula-leading creator statement cells", async () => {
    const creator = await register("Statement Creator", "statement-formula@example.com");
    await prisma.earningsLedgerEntry.create({
      data: {
        channelId: creator.user.channel.id,
        type: "ADJUSTMENT",
        state: "ADJUSTMENT",
        amount: "1.000000",
        currency: "USD",
        memo: '=HYPERLINK("https://example.invalid","click")',
      },
    });

    const statement = await app.inject({
      method: "GET",
      url: "/creator/studio/revenue/statement",
      headers: { cookie: creator.cookie },
    });
    expect(statement.statusCode).toBe(200);
    const content = statement.json().content as string;
    expect(content).toContain('"\\'=HYPERLINK(""https://example.invalid"",""click"")"');
    expect(content).not.toContain('"=HYPERLINK(');
  });

  it("atomically snapshots creator payouts, keeps the snapshot immutable and never exposes ciphertext", async () => {
''',
    "finance channel and creator statement regressions",
)

replace_once(
    "apps/api/test/admin-operations.integration.test.ts",
    '''  it("scopes global search result kinds to each staff role", async () => {
''',
    '''  it("neutralizes formula-leading cells in administrative CSV exports", async () => {
    const operations = await register("CSV Operations", "csv-operations@example.com");
    const target = await register("CSV Target", "csv-target@example.com");
    await grant(operations.user.account.id, "OPERATIONS");
    await prisma.account.update({
      where: { id: target.user.account.id },
      data: { displayName: '=HYPERLINK("https://example.invalid","click")' },
    });

    const exported = await app.inject({
      method: "GET",
      url: "/admin/operations/exports/users",
      headers: { cookie: operations.cookie },
    });
    expect(exported.statusCode).toBe(200);
    const content = exported.json().content as string;
    expect(content).toContain('"\\'=HYPERLINK(""https://example.invalid"",""click"")"');
    expect(content).not.toContain('"=HYPERLINK(');
  });

  it("scopes global search result kinds to each staff role", async () => {
''',
    "admin CSV formula regression",
)
