import { describe, expect, it } from "vitest";

import {
  AUTO_HOME_CANDIDATE_LIMIT,
  AUTO_HOME_ROW_LIMIT,
  composeAutomaticHome,
  homeStatusAfterRows,
  resolveHomeMode,
  type AutomaticHomeCandidate,
  type HomeResponse,
} from "./home-composition.js";

function candidate(
  id: string,
  overrides: Partial<Omit<AutomaticHomeCandidate, "item">> = {},
): AutomaticHomeCandidate {
  return {
    item: {
      id,
      type: "VIDEO",
      title: `Published title ${id}`,
      href: `/watch/${id}`,
      kicker: "Recently added",
      meta: "Creator · 10:00",
      artworkObjectKey: `${id}/thumbnail.jpg`,
    },
    creatorId: "creator-a",
    contentType: "MOVIE",
    videoForm: "LONG_FORM",
    description: `Description ${id}`,
    durationMs: 600_000,
    channelName: "Creator",
    ...overrides,
  };
}

function renderedIds(home: HomeResponse) {
  return [
    ...(home.spotlight ? [home.spotlight.id] : []),
    ...home.rows.flatMap((row) => row.items.map((item) => item.id)),
  ];
}

describe("homepage ownership and status", () => {
  it.each([undefined, null, "INHERIT", "unexpected"])(
    "infers ownership conservatively for %s without treating disabled rows as absent",
    (choice) => {
      expect(resolveHomeMode(choice, false)).toBe("AUTO");
      expect(resolveHomeMode(choice, true)).toBe("MANAGED");
    },
  );

  it("honors explicit operator modes regardless of stored rows", () => {
    expect(resolveHomeMode("AUTO", true)).toBe("AUTO");
    expect(resolveHomeMode("MANAGED", false)).toBe("MANAGED");
  });

  it("recomputes emptiness after managed regional filtering without enabling a disabled home", () => {
    expect(homeStatusAfterRows({ status: "READY", spotlight: null }, [])).toBe("EMPTY");
    expect(homeStatusAfterRows({ status: "DISABLED", spotlight: null }, [])).toBe("DISABLED");
    expect(
      homeStatusAfterRows({ status: "EMPTY", spotlight: null }, [{ items: [candidate("a").item] }]),
    ).toBe("READY");
  });
});

describe("automatic homepage composition", () => {
  it("has a truthful empty state without fabricated content or rows", () => {
    expect(composeAutomaticHome([])).toEqual({
      mode: "AUTO",
      status: "EMPTY",
      spotlight: null,
      rows: [],
    });
  });

  it("makes one real title useful as a spotlight and preserves its publishing metadata", () => {
    const video = candidate("single");
    const home = composeAutomaticHome([video]);
    expect(home.status).toBe("READY");
    expect(home.spotlight).toMatchObject({
      ...video.item,
      description: video.description,
      durationMs: video.durationMs,
      channelName: video.channelName,
    });
    expect(home.rows).toEqual([]);
  });

  it("presents a sparse single-creator catalogue once per title", () => {
    const home = composeAutomaticHome([candidate("first"), candidate("second")]);
    expect(home.spotlight?.id).toBe("first");
    expect(home.rows.map((row) => row.key)).toEqual(["auto-discover"]);
    expect(home.rows[0]?.items.map((item) => item.id)).toEqual(["second"]);
    expect(renderedIds(home)).toEqual(["first", "second"]);
  });

  it("prefers real long-form artwork for the spotlight without duplicating the other candidates", () => {
    const clip = candidate("clip", { videoForm: "CLIP" });
    const withoutArtwork = candidate("plain");
    withoutArtwork.item.artworkObjectKey = null;
    const home = composeAutomaticHome([clip, withoutArtwork, candidate("film")]);
    expect(home.spotlight?.id).toBe("film");
    expect(new Set(renderedIds(home)).size).toBe(3);
  });

  it("opens distinct shelves only when multiple substantial pools remain after the spotlight", () => {
    const films = Array.from({ length: 5 }, (_, index) => candidate(`film-${index}`));
    const documentaries = Array.from({ length: 4 }, (_, index) =>
      candidate(`documentary-${index}`, {
        contentType: "DOCUMENTARY",
        creatorId: "documentary-maker",
      }),
    );
    const home = composeAutomaticHome([...films, ...documentaries]);
    expect(home.rows.map((row) => row.key)).toEqual(["auto-movies", "auto-documentaries"]);
    expect(home.rows.every((row) => row.items.length === 4)).toBe(true);
    expect(new Set(renderedIds(home)).size).toBe(9);
  });

  it("keeps small format pools together instead of multiplying thin rows", () => {
    const home = composeAutomaticHome([
      candidate("film"),
      candidate("documentary", { contentType: "DOCUMENTARY" }),
      candidate("creator", { contentType: "CREATOR_VIDEO" }),
      candidate("clip", { videoForm: "CLIP" }),
    ]);
    expect(home.rows.map((row) => row.key)).toEqual(["auto-discover"]);
    expect(home.rows[0]?.items).toHaveLength(3);
  });

  it("gives clips one distinct home even when their content type is a movie", () => {
    const videos = [candidate("hero")];
    for (let index = 0; index < 4; index += 1) {
      videos.push(candidate(`clip-${index}`, { videoForm: "CLIP" }));
      videos.push(candidate(`creator-${index}`, { contentType: "CREATOR_VIDEO" }));
    }
    const home = composeAutomaticHome(videos);
    expect(home.rows.map((row) => row.source)).toEqual(["CLIPS", "CREATOR_VIDEOS"]);
    expect(home.rows[0]?.items.every((item) => item.id.startsWith("clip-"))).toBe(true);
    expect(new Set(renderedIds(home)).size).toBe(videos.length);
  });

  it("prefers an unseen title in the same tier while preserving resume order and progress", () => {
    const videos = [candidate("newest"), candidate("older"), candidate("fresh")];
    const progress = { positionMs: 42_000, completedAt: null };
    const resume = [
      { ...videos[1]!.item, kicker: "Continue Watching", progress },
      { ...videos[0]!.item, kicker: "Continue Watching", progress },
    ];
    const home = composeAutomaticHome(videos, [...resume, resume[0]!]);
    expect(home.rows[0]?.key).toBe("auto-continue-watching");
    expect(home.rows[0]?.items).toEqual(resume);
    expect(home.spotlight?.id).toBe("fresh");
    expect(new Set(renderedIds(home)).size).toBe(3);
  });

  it.each(["CLIP", "LONG_FORM"] as const)(
    "keeps resumed films in the spotlight ahead of a metadata-poor %s",
    (videoForm) => {
      const weak = candidate("unprepared", {
        creatorId: "another-creator",
        videoForm,
        description: null,
        durationMs: 9_000,
      });
      const first = candidate("first-film");
      const second = candidate("second-film");
      const videos = [weak, first, second];
      const resume = [
        { ...second.item, progress: { positionMs: 130_000, completedAt: null } },
        { ...first.item, progress: { positionMs: 84_000, completedAt: null } },
      ];
      const initial = composeAutomaticHome(videos);
      const home = composeAutomaticHome(videos, resume);

      expect(initial.spotlight?.id).toBe(first.item.id);
      expect(home.spotlight?.id).toBe(initial.spotlight?.id);
      expect(home.rows[0]?.source).toBe("CONTINUE_WATCHING");
      expect(home.rows[0]?.items).toEqual(resume);
      expect(home.rows[1]?.items).toEqual([weak.item]);
      const rowIds = home.rows.flatMap((row) => row.items.map((item) => item.id));
      expect(new Set(rowIds).size).toBe(rowIds.length);
      expect(renderedIds(home).filter((id) => id === first.item.id)).toHaveLength(2);
      expect(new Set(renderedIds(home)).size).toBe(videos.length);
    },
  );

  it.each([
    { label: "missing artwork", artworkObjectKey: null, description: "Real description" },
    { label: "blank artwork", artworkObjectKey: " \n ", description: "Real description" },
    { label: "missing description", artworkObjectKey: "cover.jpg", description: null },
    { label: "blank description", artworkObjectKey: "cover.jpg", description: " \t\n " },
  ])("keeps content with $label in a shelf without inventing a spotlight", (metadata) => {
    const video = candidate("incomplete-presentation", { description: metadata.description });
    video.item.artworkObjectKey = metadata.artworkObjectKey;

    const home = composeAutomaticHome([video]);

    expect(home.spotlight).toBeNull();
    expect(home.status).toBe("READY");
    expect(home.rows.map((row) => row.key)).toEqual(["auto-discover"]);
    expect(home.rows[0]?.items).toEqual([video.item]);
  });

  it("can feature a short catalogue and prefers the first unseen short in the same tier", () => {
    const videos = [
      candidate("first-short", { videoForm: "CLIP", durationMs: 9_000 }),
      candidate("second-short", { videoForm: "CLIP", durationMs: 20_000 }),
      candidate("third-short", { videoForm: "CLIP", durationMs: 30_000 }),
    ];
    const resume = {
      ...videos[0]!.item,
      progress: { positionMs: 3_000, completedAt: null },
    };

    expect(composeAutomaticHome(videos).spotlight?.id).toBe("first-short");
    const home = composeAutomaticHome(videos, [resume]);

    expect(home.spotlight?.id).toBe("second-short");
    expect(home.rows[0]?.items).toEqual([resume]);
    expect(home.rows[1]?.items).toEqual([videos[2]!.item]);
    expect(new Set(renderedIds(home)).size).toBe(renderedIds(home).length);
  });

  it("does not demote a long-form spotlight to an unseen short when viewing progress changes", () => {
    const short = candidate("ready-short", { videoForm: "CLIP", durationMs: 9_000 });
    const film = candidate("ready-film");
    const videos = [short, film];
    const resume = { ...film.item, progress: { positionMs: 60_000, completedAt: null } };

    expect(composeAutomaticHome(videos).spotlight?.id).toBe(film.item.id);
    const home = composeAutomaticHome(videos, [resume]);

    expect(home.spotlight?.id).toBe(film.item.id);
    expect(home.rows[0]?.items).toEqual([resume]);
    expect(home.rows[1]?.items).toEqual([short.item]);
  });

  it("counts a reused spotlight once when balancing creators in the remaining shelf", () => {
    const film = candidate("resumed-film", { creatorId: "creator-a" });
    const sameCreator = candidate("same-creator", {
      creatorId: "creator-a",
      description: null,
    });
    const otherCreator = candidate("other-creator", {
      creatorId: "creator-b",
      description: null,
    });
    const resume = { ...film.item, progress: { positionMs: 60_000, completedAt: null } };

    const home = composeAutomaticHome([film, sameCreator, otherCreator], [resume]);

    expect(home.spotlight?.id).toBe(film.item.id);
    expect(home.rows[0]?.items).toEqual([resume]);
    expect(home.rows[1]?.items).toEqual([sameCreator.item, otherCreator.item]);
  });

  it("can serve progress outside the recency pool without inventing a spotlight", () => {
    const resume = {
      ...candidate("older-progress").item,
      progress: { positionMs: 1000, completedAt: null },
    };
    const home = composeAutomaticHome([], [resume]);
    expect(home.spotlight).toBeNull();
    expect(home.status).toBe("READY");
    expect(home.rows[0]?.items).toEqual([resume]);
  });

  it("preserves row-only Kids rendering and does not introduce resume personalization", () => {
    const safe = candidate("safe");
    safe.item.href = "/watch/safe?mode=kids";
    const home = composeAutomaticHome([safe], [candidate("adult-progress").item], {
      isKidsProfile: true,
    });
    expect(home.spotlight).toBeNull();
    expect(home.rows.map((row) => row.source)).toEqual(["RECENTLY_ADDED"]);
    expect(home.rows[0]?.items).toEqual([safe.item]);
    expect(home.status).toBe("READY");
  });

  it("softens creator concentration while allowing a homogeneous catalogue to fill a row", () => {
    const dominant = Array.from({ length: 12 }, (_, index) => candidate(`a-${index}`));
    const otherCreators = ["b", "c", "d", "e"].map((creatorId) =>
      candidate(creatorId, { creatorId }),
    );
    const varied = composeAutomaticHome([...dominant, ...otherCreators]);
    const ids = renderedIds(varied);
    for (const creator of otherCreators) expect(ids).toContain(creator.item.id);
    expect(varied.rows[0]?.items).toHaveLength(AUTO_HOME_ROW_LIMIT);
    expect(composeAutomaticHome(dominant).rows[0]?.items).toHaveLength(AUTO_HOME_ROW_LIMIT);
  });

  it("is deterministic, globally duplicate-free and honest about its finite pool", () => {
    const videos = Array.from({ length: AUTO_HOME_CANDIDATE_LIMIT + 20 }, (_, index) =>
      candidate(`video-${index}`, { creatorId: `creator-${index % 7}` }),
    );
    const home = composeAutomaticHome([videos[0]!, ...videos]);
    expect(composeAutomaticHome([videos[0]!, ...videos])).toEqual(home);
    expect(new Set(renderedIds(home)).size).toBe(renderedIds(home).length);
    expect(home.rows.length).toBeLessThanOrEqual(5);
    for (const row of home.rows) {
      expect(row.nextCursor).toBeNull();
      expect(row.items.length).toBeLessThanOrEqual(AUTO_HOME_ROW_LIMIT);
      expect(row.maxItems).toBe(row.items.length);
      expect(["TRENDING_WORLDWIDE", "POPULAR_NOW", "BECAUSE_YOU_WATCHED"]).not.toContain(
        row.source,
      );
    }
    expect(renderedIds(home)).not.toContain(`video-${AUTO_HOME_CANDIDATE_LIMIT}`);
  });
});
