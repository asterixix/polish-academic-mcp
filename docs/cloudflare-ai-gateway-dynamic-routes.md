# Cloudflare AI Gateway Dynamic Routes

This frontend expects the following dynamic route aliases:

- `dynamic/academic-cheapest`
- `dynamic/academic-balanced`
- `dynamic/academic-quality`

The complex template for `academic-cheapest` is available in:

- `docs/cloudflare-ai-gateway-dynamic-route-academic-cheapest.json`

## Suggested balanced route

Use the same graph structure as `academic-cheapest`, but adjust model nodes:

- `model_primary_cheap` -> `openai / gpt-4o-mini`
- `model_secondary_cheap` -> `anthropic / claude-3-5-haiku-latest`
- `model_floor_tier` -> `workers-ai / @cf/meta/llama-3.1-8b-instruct`

## Suggested quality route

Use the same graph structure as `academic-cheapest`, but adjust model nodes:

- `model_primary_cheap` -> `openai / gpt-4.1`
- `model_secondary_cheap` -> `anthropic / claude-3-7-sonnet-latest`
- `model_floor_tier` -> `openai / gpt-4o-mini`

## Call format (compat endpoint)

Call `chat/completions` with:

```json
{
  "model": "dynamic/academic-cheapest",
  "messages": [
    {
      "role": "user",
      "content": "Find Polish papers about hydrology."
    }
  ]
}
```
