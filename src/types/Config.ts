export interface BotConfig {
  token: string;
  prefix: string;
  ownerId: string | null;
  mongoUri: string;
  logLevel: string;
  cooldown: {
    default: number;
  };
  automod: {
    maxMessages: number;
    timeWindow: number;
    muteDuration: number;
  };
  api: {
    enabled: boolean;
    port: number;
    adminToken: string | null;
    dashboardUrl: string | null;
  };
  fluxerOAuth: {
    clientId: string | null;
    clientSecret: string | null;
    redirectUri: string | null;
  };
  glitchtip: {
    dsn: string | null;
    environment: string;
  };
  validate(): boolean;
}
