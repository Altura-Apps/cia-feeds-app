"use client";

/**
 * StorefrontChatMount
 *
 * Server-rendered storefront pages embed this once when the dealer's CTA
 * intent is "ai_chat". It mounts the floating widget AND exposes a global
 * opener so the inline "Chat with us" button on the page can call
 * window.__openAIChat() to expand the widget without prop-drilling.
 */
import { useEffect, useRef } from "react";
import AIChatWidget from "./AIChatWidget";

declare global {
  interface Window {
    __openAIChat?: () => void;
  }
}

interface Props {
  dealerSlug: string;
  vehicleId?: string;
  listingId?: string;
  initialLocale?: "en" | "es";
  accentColor?: string;
}

export default function StorefrontChatMount(props: Props) {
  const openRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    window.__openAIChat = () => openRef.current?.();
    return () => {
      if (window.__openAIChat === openRef.current) {
        delete window.__openAIChat;
      }
    };
  }, []);

  return (
    <AIChatWidget {...props} __registerOpener={(fn) => (openRef.current = fn)} />
  );
}
