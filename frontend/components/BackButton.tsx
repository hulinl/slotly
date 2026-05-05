"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * "Back" affordance shown at the top-left of detail pages.
 *
 * Uses browser history when available (so the user lands wherever they
 * came from). When the page is opened directly — fresh tab, deep-linked
 * notification email, etc. — falls back to an explicit URL so the user
 * doesn't get stuck.
 */
export function BackButton({
  fallback = "/",
  label = "Back",
}: {
  fallback?: string;
  label?: string;
}) {
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    // window.history.length is 1 only on a fresh tab; anything > 1 means we
    // navigated here from somewhere within the app.
    setCanGoBack(window.history.length > 1);
  }, []);

  const className =
    "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";

  if (canGoBack) {
    return (
      <button type="button" onClick={() => router.back()} className={className}>
        <ArrowLeft size={14} aria-hidden="true" />
        {label}
      </button>
    );
  }
  return (
    <Link href={fallback} className={className}>
      <ArrowLeft size={14} aria-hidden="true" />
      {label}
    </Link>
  );
}
