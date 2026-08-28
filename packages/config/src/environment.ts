import { z } from "zod";

export const appEnvironmentSchema = z.enum(["local", "test", "staging", "production"]);

export type AppEnvironment = z.infer<typeof appEnvironmentSchema>;

export function parseEnvironment<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  return schema.parse(input);
}
