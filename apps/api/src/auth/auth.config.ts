import { Injectable } from "@nestjs/common";
import { z } from "zod";

const authEnvironmentSchema = z.object({
  APP_ENV: z.enum(["local", "test", "staging", "production"]).default("local"),
  AUTH_PASSWORD_RESET_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(1_800),
  AUTH_SESSION_TTL_SECONDS: z.coerce.number().int().min(900).max(2_592_000).default(604_800),
  AUTH_TOKEN_SECRET: z.string().min(32).optional(),
  WEB_ORIGIN: z.url().default("http://localhost:3000"),
});

const localOnlySecret = "ayin-local-development-auth-secret-not-for-production";

@Injectable()
export class AuthConfig {
  readonly appEnvironment: "local" | "test" | "staging" | "production";
  readonly passwordResetTtlSeconds: number;
  readonly sessionTtlSeconds: number;
  readonly tokenSecret: string;
  readonly webOrigin: string;

  constructor() {
    const environment = authEnvironmentSchema.parse(process.env);

    if (environment.APP_ENV === "production" && !environment.AUTH_TOKEN_SECRET) {
      throw new Error(
        "AUTH_TOKEN_SECRET is required in production and must be at least 32 characters.",
      );
    }

    this.appEnvironment = environment.APP_ENV;
    this.passwordResetTtlSeconds = environment.AUTH_PASSWORD_RESET_TTL_SECONDS;
    this.sessionTtlSeconds = environment.AUTH_SESSION_TTL_SECONDS;
    this.tokenSecret = environment.AUTH_TOKEN_SECRET ?? localOnlySecret;
    this.webOrigin = environment.WEB_ORIGIN;
  }

  get secureCookies(): boolean {
    return this.appEnvironment === "production" || this.appEnvironment === "staging";
  }
}
