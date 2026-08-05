/*
 * Real vendor marks, inlined. These are the only saturated pixels in the app —
 * every other surface is drawn from the neutral ramp in styles/tokens.css.
 * Inlined rather than fetched so nothing depends on an external host.
 */

interface MarkProps {
  size?: number;
}

export function GmailMark({ size = 18 }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M2.4 19.5h3.3V11L2 8.1v9.8c0 .9.6 1.6 1.4 1.6h-1Z" fill="#4285F4" />
      <path d="M18.3 19.5h3.3c.8 0 1.4-.7 1.4-1.6V8.1L18.3 11v8.5Z" fill="#34A853" />
      <path d="M18.3 5.8V11L23 8.1V6.5c0-1.5-1.7-2.4-2.9-1.5l-1.8 1.4Z" fill="#FBBC04" />
      <path d="M5.7 11V5.8L12 10.5l6.3-4.7V11L12 15.7 5.7 11Z" fill="#EA4335" />
      <path d="M1 6.5v1.6L5.7 11V5.8L3.9 4.4C2.7 3.5 1 4.4 1 6.5Z" fill="#C5221F" />
    </svg>
  );
}

export function SlackMark({ size = 18 }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M5.1 15.1a2.1 2.1 0 1 1-2.1-2.1h2.1v2.1Zm1 0a2.1 2.1 0 1 1 4.2 0v5.2a2.1 2.1 0 1 1-4.2 0v-5.2Z"
        fill="#E01E5A"
      />
      <path
        d="M8.2 5.1a2.1 2.1 0 1 1 2.1-2.1v2.1H8.2Zm0 1.1a2.1 2.1 0 1 1 0 4.2H3a2.1 2.1 0 1 1 0-4.2h5.2Z"
        fill="#36C5F0"
      />
      <path
        d="M18.9 8.3a2.1 2.1 0 1 1 2.1 2.1h-2.1V8.3Zm-1.1 0a2.1 2.1 0 1 1-4.2 0V3a2.1 2.1 0 1 1 4.2 0v5.3Z"
        fill="#2EB67D"
      />
      <path
        d="M15.8 18.9a2.1 2.1 0 1 1-2.1 2.1v-2.1h2.1Zm0-1a2.1 2.1 0 1 1 0-4.2H21a2.1 2.1 0 1 1 0 4.2h-5.2Z"
        fill="#ECB22E"
      />
    </svg>
  );
}

export function GoogleDocsMark({ size = 18 }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M14.2 1H5.6A1.6 1.6 0 0 0 4 2.6v18.8A1.6 1.6 0 0 0 5.6 23h12.8a1.6 1.6 0 0 0 1.6-1.6V6.8L14.2 1Z" fill="#4285F4" />
      <path d="M14.2 1v4.2c0 .9.7 1.6 1.6 1.6H20L14.2 1Z" fill="#A1C2FA" />
      <path
        d="M7.6 11.4h8.8v1.2H7.6v-1.2Zm0 2.8h8.8v1.2H7.6v-1.2Zm0 2.8h6v1.2h-6v-1.2Z"
        fill="#F1F3F4"
      />
    </svg>
  );
}

export function GoogleMark({ size = 18 }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7c2.2-2 3.4-5 3.4-8.5Z"
        fill="#4285F4"
      />
      <path
        d="M12 23.5c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3c1.9 3.8 5.8 6.3 10.2 6.3Z"
        fill="#34A853"
      />
      <path
        d="M5.6 14.2a6.9 6.9 0 0 1 0-4.4v-3H1.8a11.5 11.5 0 0 0 0 10.4l3.8-3Z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.1c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.7 1.6 15.1.5 12 .5 7.6.5 3.7 3 1.8 6.8l3.8 3c.9-2.7 3.4-4.7 6.4-4.7Z"
        fill="#EA4335"
      />
    </svg>
  );
}
