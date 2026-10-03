import "reflect-metadata";
import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { loadGamProductionConfig } from "../src/ads/gam-production.config.js";
import { GAM_PRODUCTION_CONFIG } from "../src/ads/gam-production.service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
databaseDescribe("GAM explicit age-treatment request configuration", () => {
  const prisma = createPrismaClient(databaseUrl);
  const config = loadGamProductionConfig({
    GAM_NETWORK_CODE: "1234",
    GAM_PUBLISHER_ID: `pub-${"0".repeat(16)}`,
    GAM_VIDEO_AD_UNIT_PATH: "/1234/isolated/video",
    GAM_DISPLAY_AD_UNIT_PREFIX: "/1234/isolated",
    GAM_ADS_TXT_RELATIONSHIP: "DIRECT",
    GAM_TEST_MODE: "1",
    GAM_PRODUCTION_ENABLED: "0",
  });
  let app: NestFastifyApplication;
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "gam-age-treatment-test-secret-with-more-than-32-characters";
    process.env.DATABASE_URL = databaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GAM_PRODUCTION_CONFIG)
      .useValue(config)
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(async () => {
    config.killSwitch = false;
    await prisma.platformSetting.deleteMany({
      where: { namespace: "ADVERTISING", key: "emergencyKillSwitch" },
    });
  });
  afterAll(async () => {
    await prisma.platformSetting.deleteMany({
      where: { namespace: "ADVERTISING", key: "emergencyKillSwitch" },
    });
    await app.close();
    await prisma.$disconnect();
  });
  it("defaults to private limited configuration without inventing age or identity targeting", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/ads/gam/config?deviceClass=DESKTOP",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toMatchObject({
      enabled: true,
      testMode: true,
      privacy: { mode: "LIMITED_ADS", ageTreatment: "UNSPECIFIED", nonPersonalizedAds: true },
      imaParameters: { ltd: "1" },
      targeting: {},
    });
    expect(response.json().imaParameters.tfat).toBeUndefined();
  });
  it("restricts CHILD and TEEN, retains stronger legacy flags, rejects malformed context with400 and creates no delivery/audit facts", async () => {
    const before = {
      events: await prisma.adEvent.count(),
      audits: await prisma.adminAuditLog.count(),
    };
    for (const [query, tfat] of [
      ["ageTreatment=CHILD", "1"],
      ["ageTreatment=TEEN", "2"],
      ["ageTreatment=TEEN&childDirected=1", "1"],
      ["ageTreatment=UNSPECIFIED&underAgeOfConsent=1", "1"],
    ]) {
      const response = await app.inject({
        method: "GET",
        url: `/ads/gam/config?deviceClass=MOBILE&consentMode=PERSONALIZED&${query}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().privacy.mode).toBe("NON_PERSONALIZED");
      expect(response.json().imaParameters).toMatchObject({ npa: "1", tfat });
      expect(response.json().targeting).toEqual({});
    }
    for (const query of [
      "ageTreatment=ADULT",
      "childDirected=true",
      "consentMode=UNKNOWN",
      "deviceClass=ALIEN",
      "ageTreatment=TEEN&ageTreatment=CHILD",
    ]) {
      expect(
        (await app.inject({ method: "GET", url: `/ads/gam/config?deviceClass=MOBILE&${query}` }))
          .statusCode,
      ).toBe(400);
    }
    expect(await prisma.adEvent.count()).toBe(before.events);
    expect(await prisma.adminAuditLog.count()).toBe(before.audits);
  });
  it("keeps the actual emergency and independent adapter kill switches authoritative", async () => {
    config.killSwitch = true;
    const url = "/ads/gam/config?deviceClass=TV&ageTreatment=CHILD";
    expect((await app.inject({ method: "GET", url })).json()).toEqual({
      enabled: false,
      reason: "GAM_KILL_SWITCH",
    });
    config.killSwitch = false;
    await prisma.platformSetting.create({
      data: {
        namespace: "ADVERTISING",
        key: "emergencyKillSwitch",
        value: true,
        valueType: "BOOLEAN",
        schemaVersion: 1,
      },
    });
    expect((await app.inject({ method: "GET", url })).json()).toEqual({
      enabled: false,
      reason: "EMERGENCY_KILL_SWITCH",
    });
  });
});
