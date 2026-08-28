import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { MediaStorageUnavailableError } from "../media/media-storage.adapter.js";
import { ChannelError, ChannelService, type ChannelEditInput } from "./channel.service.js";

const channelIdSchema = z.string().uuid();
const assetIdSchema = z.string().uuid();
const channelUpdateSchema = z
  .object({
    name: z.string().max(120).optional(),
    handle: z.string().max(80).optional(),
    description: z.string().max(5_000).nullable().optional(),
    accentColor: z.string().nullable().optional(),
  })
  .strict();
const assetAuthorizeSchema = z
  .object({
    kind: z.enum(["avatar", "banner"]),
    mimeType: z.string().trim().min(1).max(255),
    sizeBytes: z.number().int().positive(),
  })
  .strict();
const assetCompleteSchema = z.object({ assetId: z.string().uuid() }).strict();

@Controller("public/channels")
export class PublicChannelController {
  constructor(@Inject(ChannelService) private readonly channels: ChannelService) {}

  @Get(":handle")
  async getChannel(@Param("handle") handle: string) {
    return this.run(() => this.channels.getPublicChannel(handle));
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw channelHttpError(error);
    }
  }
}

@Controller("creator/channels")
@UseGuards(AuthGuard)
export class CreatorChannelController {
  constructor(@Inject(ChannelService) private readonly channels: ChannelService) {}

  @Get(":channelId")
  async getChannel(
    @Req() request: AuthenticatedRequest,
    @Param("channelId") channelIdRaw: string,
  ) {
    const channelId = parseId(channelIdSchema, channelIdRaw, "This channel link is invalid.");
    return this.run(() =>
      this.channels.getEditableChannel(
        { kind: "owner", accountId: request.ayinAuth.accountId },
        channelId,
      ),
    );
  }

  @Patch(":channelId")
  async updateChannel(
    @Req() request: AuthenticatedRequest,
    @Param("channelId") channelIdRaw: string,
    @Body() body: unknown,
  ) {
    const channelId = parseId(channelIdSchema, channelIdRaw, "This channel link is invalid.");
    const parsed = channelUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw channelHttpError(
        new ChannelError("INVALID_CHANNEL_UPDATE", "Check the channel details and try again."),
      );
    }
    return this.run(() =>
      this.channels.updateChannel(
        { kind: "owner", accountId: request.ayinAuth.accountId },
        channelId,
        mapChannelUpdate(parsed.data),
      ),
    );
  }

  @Post(":channelId/assets/authorize")
  async authorizeAsset(
    @Req() request: AuthenticatedRequest,
    @Param("channelId") channelIdRaw: string,
    @Body() body: unknown,
  ) {
    const channelId = parseId(channelIdSchema, channelIdRaw, "This channel link is invalid.");
    const parsed = assetAuthorizeSchema.safeParse(body);
    if (!parsed.success) {
      throw channelHttpError(
        new ChannelError(
          "INVALID_CHANNEL_IMAGE_REQUEST",
          "This channel image could not be prepared.",
        ),
      );
    }
    return this.run(() =>
      this.channels.authorizeChannelAsset(
        { kind: "owner", accountId: request.ayinAuth.accountId },
        channelId,
        parsed.data,
      ),
    );
  }

  @Post(":channelId/assets/complete")
  async completeAsset(
    @Req() request: AuthenticatedRequest,
    @Param("channelId") channelIdRaw: string,
    @Body() body: unknown,
  ) {
    const channelId = parseId(channelIdSchema, channelIdRaw, "This channel link is invalid.");
    const parsed = assetCompleteSchema.safeParse(body);
    if (!parsed.success) {
      throw channelHttpError(
        new ChannelError(
          "INVALID_CHANNEL_IMAGE_COMPLETION",
          "This channel image could not be completed.",
        ),
      );
    }
    const assetId = parseId(assetIdSchema, parsed.data.assetId, "This channel image is invalid.");
    return this.run(() =>
      this.channels.completeChannelAsset(
        { kind: "owner", accountId: request.ayinAuth.accountId },
        channelId,
        assetId,
      ),
    );
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw channelHttpError(error);
    }
  }
}

function mapChannelUpdate(input: z.infer<typeof channelUpdateSchema>): ChannelEditInput {
  const output: ChannelEditInput = {};
  if (input.name !== undefined) output.name = input.name;
  if (input.handle !== undefined) output.handle = input.handle;
  if (input.description !== undefined) output.description = input.description;
  if (input.accentColor !== undefined) output.accentColor = input.accentColor;
  return output;
}

function parseId(schema: typeof channelIdSchema, raw: string, message: string): string {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw channelHttpError(new ChannelError("INVALID_ID", message));
  }
  return parsed.data;
}

function channelHttpError(error: unknown): Error {
  if (error instanceof ChannelError) {
    return new HttpException(
      { error: { code: error.code, message: error.message } },
      error.statusCode,
    );
  }
  if (error instanceof MediaStorageUnavailableError) {
    return new HttpException(
      { error: { code: "R2_NOT_CONFIGURED", message: error.message } },
      503,
    );
  }
  return error instanceof Error ? error : new Error("Unexpected channel error.");
}
