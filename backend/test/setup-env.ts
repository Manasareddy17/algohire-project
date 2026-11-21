// Defaults so unit tests run without a .env file. Integration tests get real values from
// docker-compose (test service) or the developer's shell.
process.env.DATABASE_URL ??= 'postgresql://certiflow:certiflow@localhost:5432/certiflow_test?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379/1';
process.env.JWT_SECRET ??= 'test-jwt-secret-0123456789';
process.env.DOWNLOAD_TOKEN_SECRET ??= 'test-download-secret-0123456789';
process.env.CERTIFICATE_STORAGE_DIR ??= './storage/test-certificates';
process.env.LOG_LEVEL ??= 'silent';
process.env.DEMO_LOGIN_ENABLED ??= 'true';
