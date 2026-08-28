import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import {
  PlaylistError,
  PlaylistService,
  type PlaylistUpdateInput,
} from "./playlist.service.js";

const uuidSchema = z.string().uuid();
const visibilitySchema = z.enum(["PUBLIC", "UNLISTED", "PRIVATE"]);
const createPlaylistSchema = z
  .object({
    name: z.string().min(1).max(160),
    description: z.string().max(5_000).nullable().optional(),
    visibility: visibilitySchema.optional(),
  })
  .strict();
const updatePlaylistSchema = z
  .object({
    name: z.string().min(1).max(160).optional(),
    description: z.string().max(5_000).nullable().optional(),
    visibility: visibilitySchema.optional(),
  })
  .strict();
const addItemSchema = z.object({ videoId: uuidSchema }).strict();
const reorderSchema = z.object({ itemIds: z.array(uuidSchema).max(500) }).strict();

@Controller("public/channels")
export class PublicPlaylistController {
  constructor(@Inject(PlaylistService) private readonly playlists: PlaylistService) {}

  @Get(":handle/playlists/:slug")
  async getPlaylist(@Param("handle") handle: string, @Param("slug") slug: string) {
    return runPlaylistOperation(() => this.playlists.getPublicPlaylist(handle, slug));
  }
}

@Controller("creator/channels")
@UseGuards(AuthGuard)
export class CreatorPlaylistCollectionController {
  constructor(@Inject(PlaylistService) private readonly playlists: PlaylistService) {}

  @Get(":channelId/playlists")
  async list(@Req() request: AuthenticatedRequest, @Param("channelId") channelIdRaw: string) {
    const channelId = parseUuid(channelIdRaw, "This channel link is invalid.");
    return runPlaylistOperation(() =>
      this.playlists.listEditablePlaylists(ownerActor(request), channelId),
    );
  }

  @Post(":channelId/playlists")
  async create(
    @Req() request: AuthenticatedRequest,
    @Param("channelId") channelIdRaw: string,
    @Body() body: unknown,
  ) {
    const channelId = parseUuid(channelIdRaw, "This channel link is invalid.");
    const parsed = createPlaylistSchema.safeParse(body);
    if (!parsed.success) {
      throw playlistHttpError(
        new PlaylistError("INVALID_PLAYLIST", "Check the playlist details and try again."),
      );
    }
    return runPlaylistOperation(() =>
      this.playlists.createPlaylist(ownerActor(request), channelId, parsed.data),
    );
  }
}

@Controller("creator/playlists")
@UseGuards(AuthGuard)
export class CreatorPlaylistController {
  constructor(@Inject(PlaylistService) private readonly playlists: PlaylistService) {}

  @Get(":playlistId")
  async get(@Req() request: AuthenticatedRequest, @Param("playlistId") playlistIdRaw: string) {
    const playlistId = parseUuid(playlistIdRaw, "This playlist link is invalid.");
    return runPlaylistOperation(() =>
      this.playlists.getEditablePlaylist(ownerActor(request), playlistId),
    );
  }

  @Patch(":playlistId")
  async update(
    @Req() request: AuthenticatedRequest,
    @Param("playlistId") playlistIdRaw: string,
    @Body() body: unknown,
  ) {
    const playlistId = parseUuid(playlistIdRaw, "This playlist link is invalid.");
    const parsed = updatePlaylistSchema.safeParse(body);
    if (!parsed.success) {
      throw playlistHttpError(
        new PlaylistError("INVALID_PLAYLIST_UPDATE", "Check the playlist details and try again."),
      );
    }
    return runPlaylistOperation(() =>
      this.playlists.updatePlaylist(ownerActor(request), playlistId, mapUpdate(parsed.data)),
    );
  }

  @Delete(":playlistId")
  async remove(@Req() request: AuthenticatedRequest, @Param("playlistId") playlistIdRaw: string) {
    const playlistId = parseUuid(playlistIdRaw, "This playlist link is invalid.");
    return runPlaylistOperation(() => this.playlists.deletePlaylist(ownerActor(request), playlistId));
  }

  @Post(":playlistId/items")
  async addItem(
    @Req() request: AuthenticatedRequest,
    @Param("playlistId") playlistIdRaw: string,
    @Body() body: unknown,
  ) {
    const playlistId = parseUuid(playlistIdRaw, "This playlist link is invalid.");
    const parsed = addItemSchema.safeParse(body);
    if (!parsed.success) {
      throw playlistHttpError(
        new PlaylistError("INVALID_PLAYLIST_ITEM", "Choose a valid video for this playlist."),
      );
    }
    return runPlaylistOperation(() =>
      this.playlists.addItem(ownerActor(request), playlistId, parsed.data.videoId),
    );
  }

  @Delete(":playlistId/items/:itemId")
  async removeItem(
    @Req() request: AuthenticatedRequest,
    @Param("playlistId") playlistIdRaw: string,
    @Param("itemId") itemIdRaw: string,
  ) {
    const playlistId = parseUuid(playlistIdRaw, "This playlist link is invalid.");
    const itemId = parseUuid(itemIdRaw, "This playlist item is invalid.");
    return runPlaylistOperation(() =>
      this.playlists.removeItem(ownerActor(request), playlistId, itemId),
    );
  }

  @Put(":playlistId/items/reorder")
  async reorder(
    @Req() request: AuthenticatedRequest,
    @Param("playlistId") playlistIdRaw: string,
    @Body() body: unknown,
  ) {
    const playlistId = parseUuid(playlistIdRaw, "This playlist link is invalid.");
    const parsed = reorderSchema.safeParse(body);
    if (!parsed.success) {
      throw playlistHttpError(
        new PlaylistError("INVALID_PLAYLIST_ORDER", "Check the playlist order and try again."),
      );
    }
    return runPlaylistOperation(() =>
      this.playlists.reorderItems(ownerActor(request), playlistId, parsed.data.itemIds),
    );
  }
}

function ownerActor(request: AuthenticatedRequest) {
  return { kind: "owner" as const, accountId: request.ayinAuth.accountId };
}

function mapUpdate(input: z.infer<typeof updatePlaylistSchema>): PlaylistUpdateInput {
  const output: PlaylistUpdateInput = {};
  if (input.name !== undefined) output.name = input.name;
  if (input.description !== undefined) output.description = input.description;
  if (input.visibility !== undefined) output.visibility = input.visibility;
  return output;
}

function parseUuid(raw: string, message: string): string {
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) {
    throw playlistHttpError(new PlaylistError("INVALID_ID", message));
  }
  return parsed.data;
}

async function runPlaylistOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw playlistHttpError(error);
  }
}

function playlistHttpError(error: unknown): Error {
  if (error instanceof PlaylistError) {
    return new HttpException(
      { error: { code: error.code, message: error.message } },
      error.statusCode,
    );
  }
  return error instanceof Error ? error : new Error("Unexpected playlist error.");
}
