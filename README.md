# Fluxy

Fluxy is a Fluxer moderation and server-management bot written in TypeScript.

It includes:
- moderation commands (`ban`, `kick`, `warn`, `timeout`, etc.)
- automod modules (anti-link, anti-spam, anti-raid, ghost ping)
- utility/admin features (tickets, reaction roles, verification, logging, lockdown)
- optional API/dashboard integration

## Add Fluxy to your server (hosted by yours truly 💖)

**Most people should use the official hosted Fluxy** - with this you get updates, infrastructure, and support without running your own stack.

- **[Invite Fluxy to your server](https://web.fluxer.app/oauth2/authorize?client_id=1474069931333816428&scope=bot&permissions=4504699474930806)** — OAuth install with the recommended permissions.
- **Support & community:** [fluxer.gg/fluxy](https://fluxer.gg/fluxy)

This repository is for **self-hosting** Fluxy (your own VPS, MongoDB, env, and ops) and for contributing. If you only want the bot in Fluxer, use the invite link above.

## Requirements (self-hosting)

- Node.js `>=22`
- npm
- MongoDB

## Quick Start (self-hosting)

1. Install dependencies:

```bash
npm install
```

2. Create your environment file:

```bash
cp .env.example .env
```

3. Fill in required env vars in `.env`:
- `TOKEN`
- `MONGO_URI`

4. Run in development:

```bash
npm run dev
```

5. Build + run production build:

```bash
npm run build
npm start
```

## Environment Variables

See `.env.example` for all available variables.

Main ones:
- `TOKEN`: bot token
- `MONGO_URI`: MongoDB connection string
- `PREFIX`: default command prefix (default `!`)
- `OWNER_ID`: optional owner user ID
- `API_ENABLED`: enable API/dashboard backend (`true`/`false`)
- `API_PORT`: API port (default `4000`)
- `API_ADMIN_TOKEN`: admin token for privileged API access
- `FLUXER_OAUTH_CLIENT_ID`, `FLUXER_OAUTH_CLIENT_SECRET`, `FLUXER_OAUTH_REDIRECT_URI`: OAuth settings
- `DASHBOARD_URL`: dashboard origin URL for API/CORS integration
- `SENTRY_DSN`: optional error reporting

## Scripts

- `npm run dev` - run bot in watch mode
- `npm run dev:sharded` - run sharded manager in watch mode
- `npm run build` - compile TypeScript to `build/`
- `npm start` - run compiled bot
- `npm run start:sharded` - run compiled shard manager
- `npm test` - run tests
- `npm run test:watch` - watch tests
- `npm run test:coverage` - generate coverage report
- `npm run lint` - run ESLint

## Testing

Run all tests:

```bash
npm test
```

Run with coverage:

```bash
npm run test:coverage
```

## Deployment Notes

- The bot can run standalone or under PM2 (`pm2:*` scripts in `package.json`).
- Keep `.env` private and never commit secrets.
- If API/dashboard is enabled, set a strong `API_ADMIN_TOKEN`.

## License

Fluxy is licensed under the `Elastic License 2.0 (ELv2)`.

- See `LICENSE` for full terms.

## Licensing FAQ

### Can I self-host Fluxy?
Yes. ELv2 allows you to use, copy, modify, and self-host the software.

### What can I not do under ELv2?
ELv2 prohibits offering the software to third parties as a hosted or managed
service where users access a substantial set of the software’s features or
functionality.

### Can I get additional rights?
If you need rights beyond ELv2, see `COMMERCIAL.md` for how to request them.
