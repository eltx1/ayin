from pathlib import Path

ROOT = Path.cwd()


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text()
    if new in text:
        return
    if old not in text:
        raise RuntimeError(f"anchor missing in {path}: {old[:180]!r}")
    target.write_text(text.replace(old, new, 1))


# Search: public video eligibility must require the canonical validated MP4.
replace_once(
    "apps/api/src/search/search.service.ts",
    '''    some: {\n      kind: "SOURCE_VIDEO",\n      status: { in: ["UPLOADED", "VALIDATED"] },\n      removedAt: null,\n      mimeType: "video/mp4",\n    },''',
    '''    some: {\n      kind: "SOURCE_VIDEO",\n      status: "VALIDATED",\n      removedAt: null,\n      mimeType: "video/mp4",\n    },''',
)

# Recommendations: candidate eligibility follows the same canonical rule.
replace_once(
    "apps/api/src/recommendations/recommendation.service.ts",
    '''    some: {\n      kind: "SOURCE_VIDEO" as const,\n      status: { in: ["UPLOADED" as const, "VALIDATED" as const] },\n      removedAt: null,\n      mimeType: "video/mp4",\n    },''',
    '''    some: {\n      kind: "SOURCE_VIDEO" as const,\n      status: "VALIDATED" as const,\n      removedAt: null,\n      mimeType: "video/mp4",\n    },''',
)

# Clips: never admit or select a raw source. Thumbnails may still be newly uploaded.
replace_once(
    "apps/api/src/creator/clips.service.ts",
    '''          some: {\n            kind: "SOURCE_VIDEO",\n            status: { in: ["UPLOADED", "VALIDATED"] },\n            removedAt: null,\n          },''',
    '''          some: {\n            kind: "SOURCE_VIDEO",\n            status: "VALIDATED",\n            removedAt: null,\n            mimeType: "video/mp4",\n          },''',
)
replace_once(
    "apps/api/src/creator/clips.service.ts",
    '''          where: {\n            kind: { in: ["SOURCE_VIDEO", "THUMBNAIL"] },\n            status: { in: ["UPLOADED", "VALIDATED"] },\n            removedAt: null,\n          },''',
    '''          where: {\n            removedAt: null,\n            OR: [\n              { kind: "SOURCE_VIDEO", status: "VALIDATED", mimeType: "video/mp4" },\n              { kind: "THUMBNAIL", status: { in: ["UPLOADED", "VALIDATED"] } },\n            ],\n          },''',
)

# Public channel pages must not list published rows that are still only raw uploads.
replace_once(
    "apps/api/src/creator/channel.service.ts",
    '''        where: {\n          status: "PUBLISHED" as const,\n          visibility: "PUBLIC" as const,\n          removedAt: null,\n        },''',
    '''        where: {\n          status: "PUBLISHED" as const,\n          visibility: "PUBLIC" as const,\n          removedAt: null,\n          mediaAssets: {\n            some: {\n              kind: "SOURCE_VIDEO" as const,\n              status: "VALIDATED" as const,\n              removedAt: null,\n              mimeType: "video/mp4",\n            },\n          },\n        },''',
)

# Public playlist items inherit the same playback-readiness invariant.
replace_once(
    "apps/api/src/creator/playlist.service.ts",
    '''            video: {\n              status: "PUBLISHED",\n              visibility: "PUBLIC",\n              removedAt: null,\n            },''',
    '''            video: {\n              status: "PUBLISHED",\n              visibility: "PUBLIC",\n              removedAt: null,\n              mediaAssets: {\n                some: {\n                  kind: "SOURCE_VIDEO",\n                  status: "VALIDATED",\n                  removedAt: null,\n                  mimeType: "video/mp4",\n                },\n              },\n            },''',
)

# Creator TV library, preference validation and admin schedule payloads must all use
# canonical source video while retaining flexible thumbnail states.
replace_once(
    "apps/api/src/creator/creator-tv.service.ts",
    '''          some: {\n            kind: "SOURCE_VIDEO",\n            status: { in: ["UPLOADED", "VALIDATED"] },\n            removedAt: null,\n            mimeType: MP4_MIME_TYPE,\n          },''',
    '''          some: {\n            kind: "SOURCE_VIDEO",\n            status: "VALIDATED",\n            removedAt: null,\n            mimeType: MP4_MIME_TYPE,\n          },''',
)
replace_once(
    "apps/api/src/creator/creator-tv.service.ts",
    '''          where: {\n            kind: { in: ["SOURCE_VIDEO", "THUMBNAIL"] },\n            status: { in: ["UPLOADED", "VALIDATED"] },\n            removedAt: null,\n          },''',
    '''          where: {\n            removedAt: null,\n            OR: [\n              { kind: "SOURCE_VIDEO", status: "VALIDATED", mimeType: MP4_MIME_TYPE },\n              { kind: "THUMBNAIL", status: { in: ["UPLOADED", "VALIDATED"] } },\n            ],\n          },''',
)
replace_once(
    "apps/api/src/creator/creator-tv.service.ts",
    '''          some: {\n            kind: "SOURCE_VIDEO",\n            status: { in: ["UPLOADED", "VALIDATED"] },\n            removedAt: null,\n            mimeType: MP4_MIME_TYPE,\n          },''',
    '''          some: {\n            kind: "SOURCE_VIDEO",\n            status: "VALIDATED",\n            removedAt: null,\n            mimeType: MP4_MIME_TYPE,\n          },''',
)
replace_once(
    "apps/api/src/creator/creator-tv.service.ts",
    '''              where: {\n                kind: { in: ["SOURCE_VIDEO", "THUMBNAIL"] },\n                status: { in: ["UPLOADED", "VALIDATED"] },\n                removedAt: null,\n              },''',
    '''              where: {\n                removedAt: null,\n                OR: [\n                  { kind: "SOURCE_VIDEO", status: "VALIDATED", mimeType: MP4_MIME_TYPE },\n                  { kind: "THUMBNAIL", status: { in: ["UPLOADED", "VALIDATED"] } },\n                ],\n              },''',
)

# Unit regression: Search query must carry the canonical source predicate.
replace_once(
    "apps/api/src/search/search.service.test.ts",
    'import { describe, expect, it } from "vitest";\n',
    'import { describe, expect, it, vi } from "vitest";\n',
)
replace_once(
    "apps/api/src/search/search.service.test.ts",
    '''  it("rejects undersized queries and malformed cursors", async () => {''',
    '''  it("requires a validated MP4 source for public video search candidates", async () => {\n    const findMany = vi.fn(async () => []);\n    const service = new SearchService({\n      client: {\n        video: { findMany },\n        channel: { findMany: vi.fn(async () => []) },\n        playlist: { findMany: vi.fn(async () => []) },\n        creatorTvChannel: { findMany: vi.fn(async () => []) },\n      },\n    } as never);\n\n    await service.search("film");\n    expect(findMany).toHaveBeenCalledWith(\n      expect.objectContaining({\n        where: expect.objectContaining({\n          AND: expect.arrayContaining([\n            expect.objectContaining({\n              mediaAssets: {\n                some: expect.objectContaining({\n                  kind: "SOURCE_VIDEO",\n                  status: "VALIDATED",\n                  mimeType: "video/mp4",\n                }),\n              },\n            }),\n          ]),\n        }),\n      }),\n    );\n  });\n\n  it("rejects undersized queries and malformed cursors", async () => {''',
)

# Unit regression: Recommendation candidates use only canonical video sources.
replace_once(
    "apps/api/src/recommendations/recommendation.service.test.ts",
    '''    expect(result.mode).toBe("SAFE_FALLBACK");\n    expect(result.items[0]?.reason.code).toBe("SAFE_FALLBACK");''',
    '''    expect(result.mode).toBe("SAFE_FALLBACK");\n    expect(result.items[0]?.reason.code).toBe("SAFE_FALLBACK");\n    expect(database.client.video.findMany).toHaveBeenCalledWith(\n      expect.objectContaining({\n        where: expect.objectContaining({\n          mediaAssets: {\n            some: expect.objectContaining({\n              kind: "SOURCE_VIDEO",\n              status: "VALIDATED",\n              mimeType: "video/mp4",\n            }),\n          },\n        }),\n      }),\n    );''',
)

# Unit regression: Clips both gates candidates and filters selected SOURCE_VIDEO rows.
replace_once(
    "apps/api/src/creator/clips.service.test.ts",
    '''          visibility: "PUBLIC",\n        }),\n      }),\n    );''',
    '''          visibility: "PUBLIC",\n          mediaAssets: {\n            some: expect.objectContaining({\n              kind: "SOURCE_VIDEO",\n              status: "VALIDATED",\n              mimeType: "video/mp4",\n            }),\n          },\n        }),\n        select: expect.objectContaining({\n          mediaAssets: expect.objectContaining({\n            where: expect.objectContaining({\n              OR: expect.arrayContaining([\n                expect.objectContaining({\n                  kind: "SOURCE_VIDEO",\n                  status: "VALIDATED",\n                  mimeType: "video/mp4",\n                }),\n              ]),\n            }),\n          }),\n        }),\n      }),\n    );''',
)

# Channel integration: one canonical video is visible; an otherwise-published raw upload is not.
replace_once(
    "apps/api/test/channel-pages.integration.test.ts",
    '''    await prisma.video.create({\n      data: {\n        id: publicVideoId,\n        channelId,\n        slug: `public-${publicVideoId.slice(0, 8)}`,\n        title: "Visible Worldwide",\n        status: "PUBLISHED",\n        visibility: "PUBLIC",\n        publishedAt: new Date(),\n      },\n    });''',
    '''    await prisma.video.create({\n      data: {\n        id: publicVideoId,\n        channelId,\n        slug: `public-${publicVideoId.slice(0, 8)}`,\n        title: "Visible Worldwide",\n        status: "PUBLISHED",\n        visibility: "PUBLIC",\n        publishedAt: new Date(),\n      },\n    });\n    await prisma.mediaAsset.create({\n      data: {\n        id: randomUUID(),\n        channelId,\n        videoId: publicVideoId,\n        kind: "SOURCE_VIDEO",\n        status: "VALIDATED",\n        r2ObjectKey: `channels/${channelId}/media/${publicVideoId}/canonical.mp4`,\n        mimeType: "video/mp4",\n        sizeBytes: 1024n,\n      },\n    });\n\n    const rawVideoId = randomUUID();\n    await prisma.video.create({\n      data: {\n        id: rawVideoId,\n        channelId,\n        slug: `raw-${rawVideoId.slice(0, 8)}`,\n        title: "Still Processing",\n        status: "PUBLISHED",\n        visibility: "PUBLIC",\n        publishedAt: new Date(),\n      },\n    });\n    await prisma.mediaAsset.create({\n      data: {\n        id: randomUUID(),\n        channelId,\n        videoId: rawVideoId,\n        kind: "SOURCE_VIDEO",\n        status: "UPLOADED",\n        r2ObjectKey: `channels/${channelId}/media/${rawVideoId}/raw.mov`,\n        mimeType: "video/quicktime",\n        sizeBytes: 1024n,\n      },\n    });''',
)
replace_once(
    "apps/api/test/channel-pages.integration.test.ts",
    '''    expect(body.videos[0].title).toBe("Visible Worldwide");''',
    '''    expect(body.videos[0].title).toBe("Visible Worldwide");\n    expect(body.videos.some((video: { title: string }) => video.title === "Still Processing")).toBe(\n      false,\n    );''',
)

# Playlist integration helper produces canonical media by default; a raw-only row is explicitly tested.
replace_once(
    "apps/api/test/playlist-product.integration.test.ts",
    '''  async function publishedVideo(\n    channelId: string,\n    title: string,\n    visibility: "PUBLIC" | "UNLISTED" | "PRIVATE" = "PUBLIC",\n  ) {\n    const id = randomUUID();\n    return prisma.video.create({\n      data: {\n        id,\n        channelId,\n        slug: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${id.slice(0, 8)}`,\n        title,\n        status: "PUBLISHED",\n        visibility,\n        publishedAt: new Date(),\n      },\n    });\n  }''',
    '''  async function publishedVideo(\n    channelId: string,\n    title: string,\n    visibility: "PUBLIC" | "UNLISTED" | "PRIVATE" = "PUBLIC",\n    assetStatus: "UPLOADED" | "VALIDATED" = "VALIDATED",\n  ) {\n    const id = randomUUID();\n    const video = await prisma.video.create({\n      data: {\n        id,\n        channelId,\n        slug: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${id.slice(0, 8)}`,\n        title,\n        status: "PUBLISHED",\n        visibility,\n        publishedAt: new Date(),\n      },\n    });\n    await prisma.mediaAsset.create({\n      data: {\n        id: randomUUID(),\n        channelId,\n        videoId: id,\n        kind: "SOURCE_VIDEO",\n        status: assetStatus,\n        r2ObjectKey: `channels/${channelId}/media/${id}/${assetStatus.toLowerCase()}.mp4`,\n        mimeType: "video/mp4",\n        sizeBytes: 1024n,\n      },\n    });\n    return video;\n  }''',
)
replace_once(
    "apps/api/test/playlist-product.integration.test.ts",
    '''    const publicVideo = await publishedVideo(owner.user.channel.id, "Public Video", "PUBLIC");\n    const privateVideo = await publishedVideo(owner.user.channel.id, "Private Video", "PRIVATE");\n\n    for (const video of [publicVideo, privateVideo]) {''',
    '''    const publicVideo = await publishedVideo(owner.user.channel.id, "Public Video", "PUBLIC");\n    const privateVideo = await publishedVideo(owner.user.channel.id, "Private Video", "PRIVATE");\n    const rawVideo = await publishedVideo(\n      owner.user.channel.id,\n      "Still Processing",\n      "PUBLIC",\n      "UPLOADED",\n    );\n\n    for (const video of [publicVideo, privateVideo, rawVideo]) {''',
)
replace_once(
    "apps/api/test/playlist-product.integration.test.ts",
    '''    expect(\n      publicPage\n        .json()\n        .items.some((item: { video: { title: string } }) => item.video.title === "Private Video"),\n    ).toBe(false);''',
    '''    expect(\n      publicPage\n        .json()\n        .items.some((item: { video: { title: string } }) => item.video.title === "Private Video"),\n    ).toBe(false);\n    expect(\n      publicPage\n        .json()\n        .items.some((item: { video: { title: string } }) => item.video.title === "Still Processing"),\n    ).toBe(false);''',
)

# Creator TV helper is canonical by default and explicitly seeds one raw-processing row.
replace_once(
    "apps/api/test/creator-tv.integration.test.ts",
    '''    options: { visibility?: "PUBLIC" | "PRIVATE"; mimeType?: string } = {},''',
    '''    options: {\n      visibility?: "PUBLIC" | "PRIVATE";\n      mimeType?: string;\n      assetStatus?: "UPLOADED" | "VALIDATED";\n    } = {},''',
)
replace_once(
    "apps/api/test/creator-tv.integration.test.ts",
    '''        kind: "SOURCE_VIDEO",\n        status: "UPLOADED",\n        r2ObjectKey: `channels/${channelId}/media/${id}/source.mp4`,''',
    '''        kind: "SOURCE_VIDEO",\n        status: options.assetStatus ?? "VALIDATED",\n        r2ObjectKey: `channels/${channelId}/media/${id}/source.mp4`,''',
)
replace_once(
    "apps/api/test/creator-tv.integration.test.ts",
    '''    await publishMp4(owner.user.channel.id, "Wrong Container", 60_000, {\n      mimeType: "video/webm",\n    });''',
    '''    await publishMp4(owner.user.channel.id, "Wrong Container", 60_000, {\n      mimeType: "video/webm",\n    });\n    await publishMp4(owner.user.channel.id, "Still Processing", 60_000, {\n      assetStatus: "UPLOADED",\n    });''',
)

print("AYIN canonical public-media hardening patch applied.")
