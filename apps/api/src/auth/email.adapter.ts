import { Injectable } from "@nestjs/common";

export interface PasswordResetEmail {
  email: string;
  resetUrl: string;
}

export interface EmailAdapter {
  readonly configured: boolean;
  sendPasswordReset(message: PasswordResetEmail): Promise<void>;
}

export const EMAIL_ADAPTER = Symbol("EMAIL_ADAPTER");

@Injectable()
export class UnconfiguredEmailAdapter implements EmailAdapter {
  readonly configured = false;

  async sendPasswordReset(): Promise<void> {
    throw new Error("Email provider is not configured.");
  }
}
