import { z } from "zod";

export const registerSchema = z.object({
  email: z.email().max(320),
  name: z.string().trim().min(2).max(120),
  password: z.string().min(10).max(128),
});

export const loginSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(128),
});

export const forgotPasswordSchema = z.object({
  email: z.email().max(320),
});

export const resetPasswordSchema = z.object({
  password: z.string().min(10).max(128),
  token: z.string().min(32).max(2_048),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
