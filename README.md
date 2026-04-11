# Polish Academic MCP

Polish Academic MCP is a local MCP server for Polish academic, public, and cultural data sources. It ships as a standard npm package and speaks MCP over stdio, so desktop clients can launch it directly.

The server no longer includes OAuth, token minting, or rate-limiting middleware. Those concerns were removed to keep the package focused on the tool server itself.

## Install

```bash
npm install
npm run build
```

## Run

```bash
npm start
```

Or launch it directly without a prior build:

```bash
npx polish-academic-mcp
```

For development:

```bash
npm run dev
```

## MCPB bundle

This repository includes an MCPB manifest so it can be packed as a Model Context Protocol bundle.

To build a bundle from the current project:

```bash
npm run bundle:mcpb
```

The resulting file is written to `release/polish-academic-mcp.mcpb`.

For the full release flow, including git commit/push and npm publish, use:

```bash
npm run release
```

## MCP Client Configuration

### Claude Desktop

```json
{
  "mcpServers": {
    "polish-academic-mcp": {
      "command": "npx",
      "args": ["-y", "polish-academic-mcp"]
    }
  }
}
```

### Cursor and other MCP clients

Use the same stdio launch command: `npx -y polish-academic-mcp`.

## Available tools

The server exposes tools for:

- Biblioteka Nauki
- RUJ, AGH, AMU, UAFM, ICM
- RePOD and RODBuK
- dane.gov.pl and BDL (GUS)
- IMGW weather and warnings
- PBN, POL-on, ISAP, SAOS
- NAC, Ninateka, Fototeka, FilmPolski, Wolne Lektury, and more

The full registry lives in [src/server.ts](src/server.ts).

## Environment

Optional environment variables used by some tools:

- `BDL_CLIENT_ID`
- `WEB3FORMS_ACCESS_KEY`
- `PBN_APP_ID`
- `PBN_APP_TOKEN`
- `PBN_USER_TOKEN`

## Development

```bash
npm run lint
npm run build
```

## Package layout

- `src/index.ts` is the stdio entrypoint
- `src/server.ts` registers the MCP tools
- `src/cache.ts` provides the in-memory cache adapter used by the Node runtime

## License

MIT
