import WelcomeOverlay from "@/components/welcome-overlay";
import ChatUI from "@/components/chat-ui";

export default function Page() {
  return (
    <>
      <a className="sr-only" href="#chat-main">Skip to conversation</a>
      <WelcomeOverlay />
      <main id="chat-main" className="app-main">
        <ChatUI />
      </main>
    </>
  );
}
