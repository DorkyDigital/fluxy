# Fluxy

![License: ELv2](https://img.shields.io/badge/license-ELv2-blue) ![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen) [![Crowdin](https://badges.crowdin.net/fluxy/localized.svg)](https://crowdin.com/project/fluxy)

Fluxy is a Fluxer moderation and server-management bot written in TypeScript.

**Moderation** - `ban`, `kick`, `warn`, `timeout`, and the usual suspects  
**Automod** - anti-link, anti-spam, anti-raid, ghost ping detection  
**Admin & utility** - tickets, reaction roles, verification, logging, lockdown  
**Optional** - REST API + dashboard backend

---

## Just want the bot?

Use the hosted version. You get updates and infrastructure without doing anything at all!

→ **[Invite Fluxy to your server](https://web.fluxer.app/oauth2/authorize?client_id=1474069931333816428&scope=bot&permissions=4504699474930806)**  
→ **Community & support:** [fluxer.gg/fluxy](https://fluxer.gg/fluxy)

The rest of this README is for self-hosters and contributors etc.

---

## Self-hosting

### Requirements

- Node.js `>=22`
- pnpm
- MongoDB

### Quick start

```bash
# 1. Install
pnpm install

# 2. Copy and fill in the env file
cp .env.example .env

# 3. Dev
pnpm run dev

# 4. Or build + run prod
pnpm run build && pnpm start
```

The two env vars you actually need to set are `TOKEN` and `MONGO_URI`. Everything else has a default or is optional.

### Environment variables

Full list is in `.env.example`. The ones you'll actually touch:

| Variable                     | Required | Default | Description                                  |
| ---------------------------- | -------- | ------- | -------------------------------------------- |
| `TOKEN`                      | ✅       | -       | Bot token                                    |
| `MONGO_URI`                  | ✅       | -       | MongoDB connection string                    |
| `PREFIX`                     |          | `!`     | Default command prefix                       |
| `OWNER_ID`                   |          | -       | Your user ID for owner-only commands         |
| `API_ENABLED`                |          | `false` | Enable the API/dashboard backend             |
| `API_PORT`                   |          | `4000`  | Port for the API                             |
| `API_ADMIN_TOKEN`            |          | -       | Privileged API access token - make it strong |
| `FLUXER_OAUTH_CLIENT_ID`     |          | -       | OAuth client ID                              |
| `FLUXER_OAUTH_CLIENT_SECRET` |          | -       | OAuth client secret                          |
| `FLUXER_OAUTH_REDIRECT_URI`  |          | -       | OAuth redirect URI                           |
| `DASHBOARD_URL`              |          | -       | Dashboard origin for CORS                    |
| `GLITCHTIP_DSN`              |          | -       | Optional error reporting                     |

### Scripts

| Command                 | What it does                                                  |
| ----------------------- | ------------------------------------------------------------- |
| `pnpm run dev`           | Watch mode                                                    |
| `pnpm run build`         | Compile TS → `build/`                                         |
| `pnpm start`             | Run compiled bot                                              |
| `pnpm test`              | Run tests                                                     |
| `pnpm run test:watch`    | Watch tests                                                   |
| `pnpm run test:coverage` | Coverage report                                               |
| `pnpm run lint`          | ESLint                                                        |
| `pnpm run i18n:check`    | Validate locale JSON files (keys + placeholders vs `en.json`) |

### Localization

Strings live under [`src/locales/`](src/locales/): **`en.json`** is the source; other files are named by locale (for example `de.json`, `zh-CN.json`). The bot loads every `*.json` in that folder at runtime; `pnpm run build` copies them into `build/locales/` for production.

**Crowdin:** [Fluxy on Crowdin](https://crowdin.com/project/fluxy) — translations are synced from this repo via [`crowdin.yml`](crowdin.yml) (source `src/locales/en.json`, translations `src/locales/%locale%.json`).

### Deployment

Fluxy runs fine standalone or under PM2. There are `pm2:*` scripts in `package.json` for that. Don't commit your `.env`, and if you're enabling the API, set a strong `API_ADMIN_TOKEN`.

---

## Contributing

PRs and issues are welcome. See `CONTRIBUTING.md`.

---

## License

Licensed under the **Elastic License 2.0 (ELv2)** - see `LICENSE`.

TLDR: self-hosting and modifying is fine. Offering Fluxy as a hosted/managed service to others is not. Need different terms? See `COMMERCIAL.md`.
