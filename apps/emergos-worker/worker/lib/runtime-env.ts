export type RuntimeEnv = Env & {
  TURNSTILE_SECRET_KEY?: string;
  SESSION_SECRET?: string;
  ADMIN_BOOTSTRAP_EMAIL?: string;
  EMAIL_FORWARD_TO?: string;
  EMAIL_FROM?: string;
  OPTIONAL_EMAIL_PROVIDER_API_KEY?: string;
  OPTIONAL_SMS_PROVIDER_API_KEY?: string;
  OPTIONAL_WHATSAPP_PROVIDER_API_KEY?: string;
  ENABLE_WORKERS_AI?: string;
  ENABLE_VECTORIZE?: string;
  ENABLE_PWA?: string;
  BYPASS_TURNSTILE?: string;
};
