import { z } from 'zod';

// Fail fast on boot instead of failing at runtime on a typo'd env var.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(16),
  DOWNLOAD_TOKEN_SECRET: z.string().min(16),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:8080'),
  WHATSAPP_API_URL: z.string().url().default('http://localhost:4001'),
  WHATSAPP_TIMEOUT_MS: z.coerce.number().default(3000),
  CERTIFICATE_STORAGE_DIR: z.string().default('./storage/certificates'),
  QUALITY_REVIEW_THRESHOLD: z.coerce.number().int().positive().default(50),
  DISTRICT_APPROVALS_REQUIRED: z.coerce.number().int().min(2).default(2),
  SLA_MINUTES: z.coerce.number().positive().default(2880),
  DELIVERY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
  LOG_LEVEL: z.string().default('info'),
  // Demo-only "pick a person" login. Off unless explicitly enabled; must stay off in production.
  DEMO_LOGIN_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type AppConfig = z.infer<typeof envSchema>;

export const config: AppConfig = envSchema.parse(process.env);
