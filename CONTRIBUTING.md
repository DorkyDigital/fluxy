# Contributing to Fluxy

Thanks for your interest in improving Fluxy.

## License

By contributing, you agree that your contributions will be licensed under the same terms as the project. See [LICENSE](LICENSE) and [COMMERCIAL.md](COMMERCIAL.md) for Elastic License 2.0 (ELv2) terms.

## Development setup

- **Node.js** `>=22`
- **MongoDB** (local or Docker etc. etc.) for development
- Copy `.env.example` to `.env` and fill in values

```bash
pnpm install
pnpm run build
pnpm test
```

The dashboard lives under `dashboard/`; root `pnpm run build` should build both as configured in `package.json`.

## Pull requests

- Open an issue first for large changes or new features when possible.
- Keep PRs focused; smaller changes are easier to review.
- Fill out the [pull request template](.github/pull_request_template.md).
- Ensure `pnpm run build` and `pnpm test` pass.

## Code style

- Formatting is enforced with Prettier (see `.prettierrc`).
- Prefer clear names and small, testable changes over large refactors mixed with fixes.

## Security

Please do **not** open public issues for security vulnerabilities. See [SECURITY.md](SECURITY.md).
