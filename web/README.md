This is the frontend chat app for `polish-academic-mcp`, scaffolded with [assistant-ui](https://www.assistant-ui.com/).

## Getting Started

First, copy `.env.example` to `.env.local` and configure:

```
CF_ACCOUNT_ID=...
CF_GATEWAY_ID=...
CF_AIG_TOKEN=...
MCP_SERVER_URL=http://localhost:8788/mcp
```

Optional:

```
NEXT_PUBLIC_WORKER_CHAT_URL=https://<your-worker-domain>/chat
```

When `NEXT_PUBLIC_WORKER_CHAT_URL` is not set, the UI calls local `web/app/api/chat/route.ts`.

Then, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

The header model selector controls three AI Gateway dynamic route aliases:

- `cheapest` -> `CF_AIG_MODEL_CHEAPEST`
- `balanced` -> `CF_AIG_MODEL_BALANCED`
- `quality` -> `CF_AIG_MODEL_QUALITY`
