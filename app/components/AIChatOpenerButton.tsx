"use client";

/**
 * Inline button that pops the AI chat widget mounted elsewhere on the page
 * (StorefrontChatMount). Used in storefront page CTAs.
 */
import React from "react";

declare global {
  interface Window {
    __openAIChat?: () => void;
  }
}

interface Props {
  label: string;
  className?: string;
  style?: React.CSSProperties;
}

export default function AIChatOpenerButton({ label, className, style }: Props) {
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined") {
          window.__openAIChat?.();
        }
      }}
      className={className}
      style={{ cursor: "pointer", border: "none", ...style }}
    >
      {label}
    </button>
  );
}
