import { experimental_createMCPClient as createMCPClient } from "@ai-sdk/mcp";
import { createOpenAI } from "@ai-sdk/openai";
import { frontendTools } from "@assistant-ui/react-ai-sdk";
import {
	convertToModelMessages,
	type JSONSchema7,
	streamText,
	type ToolSet,
	type UIMessage,
} from "ai";

export const maxDuration = 30;

type ModelProfile = "cheapest" | "balanced" | "quality";

let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | null = null;
let cachedMCPTools: ToolSet | null = null;

async function getMCPTools(): Promise<ToolSet> {
	if (cachedMCPTools) return cachedMCPTools;

	try {
		const mcpUrl = process.env.MCP_SERVER_URL ?? "http://localhost:8788/mcp";
		mcpClient = await createMCPClient({
			transport: {
				type: "http",
				url: mcpUrl,
			},
		});
		cachedMCPTools = await mcpClient.tools();
		return cachedMCPTools;
	} catch (e) {
		console.warn("Failed to connect to MCP server:", e);
		mcpClient = null;
		return {};
	}
}

function getModelForProfile(profile: ModelProfile): string {
	switch (profile) {
		case "balanced":
			return process.env.CF_AIG_MODEL_BALANCED ?? "dynamic/academic-balanced";
		case "quality":
			return process.env.CF_AIG_MODEL_QUALITY ?? "dynamic/academic-quality";
		default:
			return process.env.CF_AIG_MODEL_CHEAPEST ?? "dynamic/academic-cheapest";
	}
}

function buildGatewayClient() {
	const accountId = process.env.CF_ACCOUNT_ID;
	const gatewayId = process.env.CF_GATEWAY_ID;
	const gatewayToken = process.env.CF_AIG_TOKEN;

	if (!accountId || !gatewayId || !gatewayToken) {
		throw new Error(
			"Missing AI Gateway env vars: CF_ACCOUNT_ID, CF_GATEWAY_ID, CF_AIG_TOKEN",
		);
	}

	return createOpenAI({
		apiKey: gatewayToken,
		baseURL: `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/compat`,
	});
}

export async function POST(req: Request) {
	const {
		messages,
		system,
		tools,
		config,
	}: {
		messages: UIMessage[];
		system?: string;
		tools?: Record<string, { description?: string; parameters: JSONSchema7 }>;
		config?: { modelProfile?: ModelProfile };
	} = await req.json();

	const mcpTools = await getMCPTools();
	const profile = config?.modelProfile ?? "cheapest";
	const gateway = buildGatewayClient();
	const model = getModelForProfile(profile);

	const result = streamText({
		model: gateway(model),
		messages: await convertToModelMessages(messages),
		system,
		tools: {
			...mcpTools,
			...frontendTools(tools ?? {}),
		},
	});

	return result.toUIMessageStreamResponse({
		sendReasoning: true,
	});
}
