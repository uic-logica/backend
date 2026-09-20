import { AccountKind, Role } from "@prisma/client";
import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      accountKind: AccountKind;
      username: string | null;
      mustChangePassword: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    role: Role;
    accountKind: AccountKind;
    username: string | null;
    mustChangePassword: boolean;
  }
}

declare module "@auth/core/adapters" {
  interface AdapterUser {
    role: Role;
    accountKind: AccountKind;
    username: string | null;
    mustChangePassword: boolean;
  }
}
