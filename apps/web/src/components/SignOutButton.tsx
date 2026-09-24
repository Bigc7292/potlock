"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button onClick={() => signOut({ callbackUrl: "/" })} className="text-xs uppercase tracking-widest text-rivet hover:text-white">
      Sign out
    </button>
  );
}
