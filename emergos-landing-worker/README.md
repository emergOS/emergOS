# emergOS Landing Worker

Temporary Cloudflare Worker landing page for `emergos.org` while the full emergOS MVP is being built.

## Local Development

```bash
npm install
npm run dev
```

## Deploy

```bash
npm run deploy
```

Then attach the Worker to the `emergos.org` route or custom domain in Cloudflare.

## Files

- `src/index.ts` serves the complete landing page HTML.
- `wrangler.jsonc` contains the Cloudflare Worker configuration.
- `package.json` contains local dev and deploy scripts.

