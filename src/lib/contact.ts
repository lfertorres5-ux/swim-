import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/** Public phone / email, set by the owner in Admin → Settings → Policies → Contact. */
export const getContact = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.from("platform_settings").select("support_email, support_phone").single();
  const phone = data?.support_phone?.trim() || null;
  return {
    email: data?.support_email?.trim() || null,
    phone,
    phoneHref: phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : null,
  };
});
