const REQUIRED_TWILIO_VARS = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'TWILIO_TO'] as const;

/** True if all TWILIO_* env vars are set (for test-sms and similar). */
export function isSmsConfigured(): boolean {
  return REQUIRED_TWILIO_VARS.every((name) => {
    const v = process.env[name];
    return v != null && v.trim() !== '';
  });
}

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v.trim();
}

/**
 * Twilio SMS outbound only (alerts on goal complete/fail/pause).
 * No inbound SMS or webhook: adding goals or todos via SMS is not implemented.
 * Reads TWILIO_* from process.env; single POST to Twilio Messages API.
 * If Twilio vars are not configured, returns silently (no throw).
 */
export async function sendSms(message: string): Promise<void> {
  if (!isSmsConfigured()) return;

  const accountSid = getEnv('TWILIO_ACCOUNT_SID');
  const authToken = getEnv('TWILIO_AUTH_TOKEN');
  const from = getEnv('TWILIO_FROM');
  const to = getEnv('TWILIO_TO');

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const body = new URLSearchParams({
    From: from,
    To: to,
    Body: message,
  });

  const auth = Buffer.from(`${accountSid}:${authToken}`, 'utf-8').toString('base64');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Twilio SMS failed (${res.status} ${res.statusText})${text ? `: ${text}` : ''}`);
  }
}
