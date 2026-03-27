"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
	AssistantChatTransport,
	useChatRuntime,
} from "@assistant-ui/react-ai-sdk";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { useMemo, useState } from "react";
import { Thread } from "@/components/assistant-ui/thread";
import { ThreadListSidebar } from "@/components/assistant-ui/threadlist-sidebar";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@/components/ui/sidebar";

type ModelProfile = "cheapest" | "balanced" | "quality";

export const Assistant = () => {
	const [modelProfile, setModelProfile] = useState<ModelProfile>("cheapest");
	const chatApiUrl = process.env.NEXT_PUBLIC_WORKER_CHAT_URL ?? "/api/chat";

	const transport = useMemo(
		() =>
			new AssistantChatTransport({
				api: chatApiUrl,
				body: {
					config: {
						modelProfile,
					},
				},
			}),
		[chatApiUrl, modelProfile],
	);

	const runtime = useChatRuntime({
		sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
		transport,
	});

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<SidebarProvider>
				<div className="flex h-[calc(100dvh-3.5rem)] w-full pr-0.5">
					<ThreadListSidebar />
					<SidebarInset>
						<header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
							<SidebarTrigger />
							<Separator orientation="vertical" className="mr-2 h-4" />
							<Breadcrumb>
								<BreadcrumbList>
									<BreadcrumbItem className="hidden md:block">
										<BreadcrumbLink
											href="https://www.assistant-ui.com/docs/getting-started"
											target="_blank"
											rel="noopener noreferrer"
										>
											Build Your Own ChatGPT UX
										</BreadcrumbLink>
									</BreadcrumbItem>
									<BreadcrumbSeparator className="hidden md:block" />
									<BreadcrumbItem>
										<BreadcrumbPage>Polish Academic Chat</BreadcrumbPage>
									</BreadcrumbItem>
								</BreadcrumbList>
							</Breadcrumb>
							<div className="ml-auto flex items-center gap-2">
								<label
									htmlFor="model-profile"
									className="text-muted-foreground text-xs"
								>
									Model profile
								</label>
								<select
									id="model-profile"
									value={modelProfile}
									onChange={(event) =>
										setModelProfile(event.target.value as ModelProfile)
									}
									className="rounded-md border bg-background px-2 py-1 text-xs"
								>
									<option value="cheapest">Cheapest</option>
									<option value="balanced">Balanced</option>
									<option value="quality">Quality</option>
								</select>
							</div>
						</header>
						<div className="flex-1 overflow-hidden">
							<Thread />
						</div>
					</SidebarInset>
				</div>
			</SidebarProvider>
		</AssistantRuntimeProvider>
	);
};
