import { Loader2 } from "lucide-react";

export function AppLoading({ message }: { message: string }) {
  return (
    <main className="auth">
      <div className="auth-loading">
        <Loader2 className="spin" size={16} /> {message}
      </div>
    </main>
  );
}
