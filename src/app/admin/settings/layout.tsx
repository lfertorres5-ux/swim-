import { SettingsTabs } from "./tabs";

export default function SettingsLayout({ children }: LayoutProps<"/admin/settings">) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-stone-500">Every price and policy lives here. Changes apply to new bookings right away; existing bookings keep what they paid.</p>
      </div>
      <SettingsTabs />
      {children}
    </div>
  );
}
