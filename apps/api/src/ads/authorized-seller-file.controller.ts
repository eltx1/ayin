import { Body, Controller, Get, HttpException, Inject, Param, Put, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";

import {
  AdminGuard,
  type AdminAuthenticatedRequest,
  RequireAdminRoles,
} from "../admin/admin.guard.js";
import { AuthGuard } from "../auth/auth.guard.js";
import {
  AuthorizedSellerFileService,
  type AuthorizedSellerFileKind,
} from "./authorized-seller-file.service.js";

const kindSchema = z.enum(["ads", "app-ads"]);
const updateSchema = z
  .object({
    text: z.string().max(64 * 1024),
    reason: z.string().trim().min(8).max(500),
  })
  .strict();

@Controller("authorized-sellers")
export class PublicAuthorizedSellerFileController {
  constructor(
    @Inject(AuthorizedSellerFileService)
    private readonly files: AuthorizedSellerFileService,
  ) {}

  @Get(":kind")
  async file(@Param("kind") rawKind: string) {
    const kind = this.parseKind(rawKind);
    const snapshot = await this.files.snapshot(kind);
    return { kind, text: snapshot.finalText };
  }

  private parseKind(rawKind: string): AuthorizedSellerFileKind {
    const parsed = kindSchema.safeParse(rawKind);
    if (!parsed.success) {
      throw new HttpException(
        { error: { code: "INVALID_AUTHORIZED_SELLER_FILE", message: "Unknown seller file." } },
        404,
      );
    }
    return parsed.data;
  }
}

@Controller("admin/advertising/authorized-sellers")
@UseGuards(AuthGuard, AdminGuard)
@RequireAdminRoles("AD_MANAGER")
export class AdminAuthorizedSellerFileController {
  constructor(
    @Inject(AuthorizedSellerFileService)
    private readonly files: AuthorizedSellerFileService,
  ) {}

  @Get()
  snapshots() {
    return this.files.snapshots();
  }

  @Put(":kind")
  async update(
    @Req() request: AdminAuthenticatedRequest,
    @Param("kind") rawKind: string,
    @Body() body: unknown,
  ) {
    const kind = kindSchema.safeParse(rawKind);
    const input = updateSchema.safeParse(body);
    if (!kind.success || !input.success) {
      throw new HttpException(
        {
          error: {
            code: "INVALID_AUTHORIZED_SELLER_FILE",
            message: input.success
              ? "Unknown seller file."
              : (input.error.issues[0]?.message ?? "Invalid authorized seller file."),
          },
        },
        400,
      );
    }

    try {
      return await this.files.update(
        request.ayinAuth.accountId,
        kind.data,
        input.data.text,
        input.data.reason,
      );
    } catch (error) {
      throw new HttpException(
        {
          error: {
            code: "INVALID_AUTHORIZED_SELLER_SYNTAX",
            message: error instanceof Error ? error.message : "Invalid authorized seller file.",
          },
        },
        400,
      );
    }
  }
}
