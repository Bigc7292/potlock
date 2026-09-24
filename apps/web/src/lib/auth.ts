import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { HANDLE_PATTERN, createGuest, createUserWithGrant, findUserByHandle, verifyCredentials } from "@potlock/db";

export interface SessionUser {
  id: string;
  handle: string;
  isGuest: boolean;
}

declare module "next-auth" {
  interface Session {
    user: SessionUser;
  }
  interface User {
    id: string;
    handle: string;
    isGuest: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    handle?: string;
    isGuest?: boolean;
  }
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET,
  pages: { signIn: "/" },
  providers: [
    CredentialsProvider({
      id: "credentials",
      name: "Handle and password",
      credentials: {
        handle: { label: "Handle", type: "text" },
        password: { label: "Password", type: "password" },
        mode: { label: "Mode", type: "text" },
      },
      async authorize(credentials) {
        const handle = credentials?.handle?.trim() ?? "";
        const password = credentials?.password ?? "";
        if (!HANDLE_PATTERN.test(handle) || password.length < 6) return null;
        if (credentials?.mode === "register") {
          if (await findUserByHandle(handle)) return null;
          const user = await createUserWithGrant({ handle, password });
          return { id: user.id, handle: user.handle, isGuest: false, name: user.handle };
        }
        const user = await verifyCredentials(handle, password);
        return user ? { id: user.id, handle: user.handle, isGuest: user.isGuest, name: user.handle } : null;
      },
    }),
    CredentialsProvider({
      id: "guest",
      name: "Play as guest",
      credentials: {},
      async authorize() {
        const user = await createGuest();
        return { id: user.id, handle: user.handle, isGuest: true, name: user.handle };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.handle = user.handle;
        token.isGuest = user.isGuest;
      }
      return token;
    },
    session({ session, token }) {
      if (token.uid && token.handle) {
        session.user = { id: token.uid, handle: token.handle, isGuest: token.isGuest ?? false };
      }
      return session;
    },
  },
};

export async function currentUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.id ? session.user : null;
}
