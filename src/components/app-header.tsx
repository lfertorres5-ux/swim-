import type { CurrentUser } from "@/lib/auth";
import { AppHeaderClient } from "./app-header-client";

type NavItem = { href: string; label: string };

export function AppHeader({ user, nav = [] }: { user: CurrentUser; nav?: NavItem[] }) {
  // Only the display name crosses to the client.
  return <AppHeaderClient name={user.firstName ?? user.email.split("@")[0]} nav={nav} />;
}
