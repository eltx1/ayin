import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import {
  platformSettingCatalog,
  platformSettingKeys,
  type PlatformSettingKey,
} from "./platform-settings.catalog.js";

export class PlatformSettingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformSettingValidationError";
  }
}

export interface PlatformProvisioningDefaults {
  uploadsPlaylistName: string;
  creatorTvNameTemplate: string;
  autoAddPublishedUploadsToCreatorTv: boolean;
  defaultVideoVisibility: "PUBLIC" | "UNLISTED" | "PRIVATE";
  defaultCommentsEnabled: boolean;
  defaultCreatorRevenueShareBps: number;
}

@Injectable()
export class PlatformSettingsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async get<K extends PlatformSettingKey>(key: K): Promise<unknown> {
    return (await this.getResolved(key)).value;
  }

  async getResolved(key: PlatformSettingKey) {
    const definition = platformSettingCatalog[key];
    const row = await this.database.client.platformSetting.findUnique({
      where: { namespace_key: { namespace: definition.namespace, key: definition.key } },
      select: { schemaVersion: true, value: true, valueType: true },
    });
    return this.resolve(definition, row);
  }

  async getResolvedInTransaction(tx: Prisma.TransactionClient, key: PlatformSettingKey) {
    const definition = platformSettingCatalog[key];
    const row = await tx.platformSetting.findUnique({
      where: { namespace_key: { namespace: definition.namespace, key: definition.key } },
      select: { schemaVersion: true, value: true, valueType: true },
    });
    return this.resolve(definition, row);
  }

  async listResolved() {
    return Promise.all(
      platformSettingKeys.map(async (key) => {
        const definition = platformSettingCatalog[key];
        const resolved = await this.getResolved(key);
        return {
          key,
          namespace: definition.namespace,
          label: definition.label,
          description: definition.description,
          control: definition.control,
          options: "options" in definition ? definition.options : undefined,
          unit: "unit" in definition ? definition.unit : undefined,
          highImpact: definition.highImpact,
          superadminOnly: definition.superadminOnly,
          defaultValue: definition.defaultValue,
          value: resolved.value,
          source: resolved.source,
        };
      }),
    );
  }

  validate(key: PlatformSettingKey, rawValue: unknown): unknown {
    const result = platformSettingCatalog[key].schema.safeParse(rawValue);
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? "Setting value is invalid.";
      throw new PlatformSettingValidationError(message);
    }
    return result.data;
  }

  async setInTransaction(tx: Prisma.TransactionClient, key: PlatformSettingKey, rawValue: unknown) {
    const definition = platformSettingCatalog[key];
    const value = this.validate(key, rawValue);
    return tx.platformSetting.upsert({
      where: { namespace_key: { namespace: definition.namespace, key: definition.key } },
      update: {
        value: value as Prisma.InputJsonValue,
        valueType: definition.valueType,
        schemaVersion: 1,
        description: definition.description,
      },
      create: {
        namespace: definition.namespace,
        key: definition.key,
        value: value as Prisma.InputJsonValue,
        valueType: definition.valueType,
        schemaVersion: 1,
        description: definition.description,
      },
    });
  }

  async getRegistrationPolicy(): Promise<{
    registrationEnabled: boolean;
    automaticCreatorProvisioningEnabled: boolean;
  }> {
    const [registrationEnabled, automaticCreatorProvisioningEnabled] = await Promise.all([
      this.get("registrationEnabled"),
      this.get("automaticCreatorProvisioningEnabled"),
    ]);
    return {
      registrationEnabled: registrationEnabled as boolean,
      automaticCreatorProvisioningEnabled: automaticCreatorProvisioningEnabled as boolean,
    };
  }

  async getProvisioningDefaults(): Promise<PlatformProvisioningDefaults> {
    const [
      uploadsPlaylistName,
      creatorTvNameTemplate,
      autoAddPublishedUploadsToCreatorTv,
      defaultVideoVisibility,
      defaultCommentsEnabled,
      defaultCreatorRevenueShareBps,
    ] = await Promise.all([
      this.get("uploadsPlaylistName"),
      this.get("creatorTvNameTemplate"),
      this.get("autoAddPublishedUploadsToCreatorTv"),
      this.get("defaultVideoVisibility"),
      this.get("defaultCommentsEnabled"),
      this.get("defaultCreatorRevenueShareBps"),
    ]);

    return {
      uploadsPlaylistName: uploadsPlaylistName as string,
      creatorTvNameTemplate: creatorTvNameTemplate as string,
      autoAddPublishedUploadsToCreatorTv: autoAddPublishedUploadsToCreatorTv as boolean,
      defaultVideoVisibility: defaultVideoVisibility as PlatformProvisioningDefaults["defaultVideoVisibility"],
      defaultCommentsEnabled: defaultCommentsEnabled as boolean,
      defaultCreatorRevenueShareBps: defaultCreatorRevenueShareBps as number,
    };
  }

  private resolve(
    definition: (typeof platformSettingCatalog)[PlatformSettingKey],
    row: { schemaVersion: number; value: unknown; valueType: string } | null,
  ): { value: unknown; source: "stored" | "default" | "invalid-stored" } {
    if (!row) {
      return { value: definition.defaultValue, source: "default" };
    }
    if (row.schemaVersion !== 1 || row.valueType !== definition.valueType) {
      return { value: definition.defaultValue, source: "invalid-stored" };
    }
    const parsed = definition.schema.safeParse(row.value);
    return parsed.success
      ? { value: parsed.data, source: "stored" }
      : { value: definition.defaultValue, source: "invalid-stored" };
  }
}
