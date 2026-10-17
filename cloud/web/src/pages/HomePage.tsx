import { RuntimeProvider } from "@/components/chat/RuntimeProvider";
import { Thread } from "@/components/chat/Thread";

export function HomePage() {
  return (
    <RuntimeProvider>
      <Thread />
    </RuntimeProvider>
  );
}
