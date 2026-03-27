import { BookOpenText, Github } from "lucide-react";
import Link from "next/link";
import type * as React from "react";
import { ThreadList } from "@/components/assistant-ui/thread-list";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
} from "@/components/ui/sidebar";

export function ThreadListSidebar({
	...props
}: React.ComponentProps<typeof Sidebar>) {
	return (
		<Sidebar {...props}>
			<SidebarHeader className="aui-sidebar-header mb-2 border-b">
				<div className="aui-sidebar-header-content flex items-center justify-between">
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton size="lg" asChild>
								<Link
									href="https://sendyka.dev"
									target="_blank"
									rel="noopener noreferrer"
								>
									<div className="aui-sidebar-header-icon-wrapper flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
										<BookOpenText className="aui-sidebar-header-icon size-4" />
									</div>
									<div className="aui-sidebar-header-heading mr-6 flex flex-col gap-0.5 leading-none">
										<span className="aui-sidebar-header-title font-semibold">
											sendyka.dev
										</span>
										<span className="text-muted-foreground text-xs">
											Polish Academic Assistant
										</span>
									</div>
								</Link>
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</div>
			</SidebarHeader>
			<SidebarContent className="aui-sidebar-content px-2">
				<ThreadList />
			</SidebarContent>
			<SidebarRail />
			<SidebarFooter className="aui-sidebar-footer border-t">
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton size="lg" asChild>
							<Link
								href="https://github.com/asterixix/polish-academic-mcp"
								target="_blank"
								rel="noopener noreferrer"
							>
								<div className="aui-sidebar-footer-icon-wrapper flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
									<Github className="aui-sidebar-footer-icon size-4" />
								</div>
								<div className="aui-sidebar-footer-heading flex flex-col gap-0.5 leading-none">
									<span className="aui-sidebar-footer-title font-semibold">
										polish-academic-mcp
									</span>
									<span>View repository</span>
								</div>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarFooter>
		</Sidebar>
	);
}
