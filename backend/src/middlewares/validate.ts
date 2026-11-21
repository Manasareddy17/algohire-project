import { ZodSchema } from 'zod';
import { BadRequestException } from '../core/exceptions';

/** Validates input against a zod schema; throws 400 with every problem listed. */
export function parseBody<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new BadRequestException('Invalid request', {
      errors: result.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
    });
  }
  return result.data;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseUuid(value: string | string[] | undefined, name = 'id'): string {
  const text = String(value ?? '');
  if (!UUID_PATTERN.test(text)) throw new BadRequestException(`Invalid ${name}`);
  return text;
}
