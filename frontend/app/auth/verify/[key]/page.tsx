"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { confirmEmail } from "@/lib/auth";
import { Button } from "@/components/ui";

type State = "verifying" | "success" | "error";

export default function VerifyEmailPage() {
  const params = useParams<{ key: string }>();
  const router = useRouter();
  const [state, setState] = useState<State>("verifying");
  const [message, setMessage] = useState<string>("");
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    // Defensive: ensure the key is URL-decoded before posting it. Allauth
    // tokens contain ':' which gets URL-encoded to %3A in the email link;
    // decodeURIComponent on an already-decoded value is a no-op.
    let key: string;
    try {
      key = decodeURIComponent(params.key);
    } catch {
      key = params.key;
    }
    confirmEmail(key)
      .then((res) => {
        if (res.meta?.is_authenticated) {
          // allauth promotes the pending session to authenticated on confirm,
          // so we can drop the user straight on the home page.
          router.replace("/");
          router.refresh();
          return;
        }
        if (res.status === 200) {
          setState("success");
          setMessage("Your email is verified. You can sign in now.");
        } else {
          setState("error");
          setMessage(
            res.errors?.[0]?.message ??
              "This confirmation link is invalid or has expired. Request a new one by signing in.",
          );
        }
      })
      .catch((err: unknown) => {
        setState("error");
        setMessage(err instanceof Error ? err.message : "Network error");
      });
  }, [params.key, router]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {state === "verifying" && "Verifying your email…"}
        {state === "success" && "Email verified"}
        {state === "error" && "Verification failed"}
      </h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {state === "verifying" ? "One moment." : message}
      </p>
      {state !== "verifying" && (
        <div className="flex flex-col gap-2">
          <Button onClick={() => router.push("/auth/login")}>Go to sign in</Button>
          <Link
            href="/"
            className="text-center text-xs text-zinc-500 underline dark:text-zinc-400"
          >
            Back to home
          </Link>
        </div>
      )}
    </div>
  );
}
