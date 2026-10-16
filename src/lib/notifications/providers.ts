import "server-only";

export type SendResult = { provider: "resend" | "twilio" | "log"; id: string };

/** Email via Resend (RESEND_API_KEY). Without a key, messages are only logged (status 'sent', provider 'log'). */
export async function sendEmail(m: { to: string; subject: string; html: string; text: string; idempotencyKey: string }): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { provider: "log", id: `log_${m.idempotencyKey}` };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": m.idempotencyKey.slice(0, 256) },
    body: JSON.stringify({ from: process.env.EMAIL_FROM ?? "Swim Lessons <onboarding@resend.dev>", to: [m.to], subject: m.subject, html: m.html, text: m.text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { id: string };
  return { provider: "resend", id: body.id };
}

/** SMS via Twilio Messaging Service (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID). */
export async function sendSms(m: { to: string; body: string }): Promise<SendResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const service = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!sid || !token || !service) return { provider: "log", id: `log_sms_${Date.now()}` };
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: m.to, MessagingServiceSid: service, Body: m.body }),
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { sid: string };
  return { provider: "twilio", id: body.sid };
}
