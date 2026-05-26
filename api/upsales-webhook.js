// Vercel Serverless Function: POST /api/upsales-webhook
// Receives Upsales trigger webhook (Möte skapande, Mötestyp Inbound)
// Posts Enhanced Conversion for Leads to Google Ads via API

import crypto from 'node:crypto';
import { GoogleAdsApi } from 'google-ads-api';

// ----- Helpers -----

const normalize = (s) => (s || '').toLowerCase().trim();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hashEmail = (email) => {
  if (!email) return null;
  // Google Ads expects lowercase, trimmed, no plus-suffix for gmail
  const e = normalize(email).replace(/\+.*@/, '@');
  return sha256(e);
};
const hashName = (name) => {
  if (!name) return null;
  return sha256(normalize(name));
};

// Parse Upsales "YYYY-MM-DD HH:mm:ss" (Stockholm time) into RFC3339 with offset
const formatConversionDateTime = (timestamp) => {
  if (!timestamp) return null;
  // Upsales sends "2026-05-26 09:58:50" in Europe/Stockholm
  // Google Ads requires e.g. "2026-05-26 09:58:50+02:00"
  // Determine offset for Stockholm (CET +01:00 / CEST +02:00)
  const d = new Date(timestamp.replace(' ', 'T') + 'Z');
  // crude DST check: Stockholm DST runs last Sun in March to last Sun in October
  const m = d.getUTCMonth();
  const dst = m >= 2 && m <= 9; // approximate; for production use a proper TZ lib
  const offset = dst ? '+02:00' : '+01:00';
  return `${timestamp}${offset}`;
};

// ----- Main handler -----

export default async function handler(req, res) {
  // Health check
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, service: 'upsales-google-ads-bridge' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Shared-secret auth (Upsales sends webhook to ?token=XYZ)
  const expectedToken = process.env.WEBHOOK_SHARED_SECRET;
  if (expectedToken) {
    const providedToken = req.query?.token || req.headers['x-webhook-token'];
    if (providedToken !== expectedToken) {
      return res.status(401).json({ error: 'Invalid or missing webhook token' });
    }
  }

  // Body parsing (Vercel auto-parses JSON if content-type is application/json)
  const payload = req.body;

  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'Missing or invalid JSON body' });
  }

  // Defensive filtering: only process Inbound appointments even if trigger misfires
  const apptType = payload?.appointment?.appointment_type;
  if (apptType !== 'Inbound') {
    console.log('Skipping non-Inbound appointment:', apptType);
    return res.status(200).json({ skipped: 'not_inbound', appointment_type: apptType });
  }

  // Required fields
  const email = payload?.contact?.email;
  if (!email || !email.includes('@')) {
    console.warn('No usable email in payload, skipping');
    return res.status(200).json({ skipped: 'no_email' });
  }

  const orderId = payload?.appointment?.id;
  if (!orderId) {
    console.warn('No appointment.id for deduplication, skipping');
    return res.status(200).json({ skipped: 'no_appointment_id' });
  }

  // Build conversion payload
  const conversionAction = `customers/${process.env.GOOGLE_ADS_CUSTOMER_ID}/conversionActions/${process.env.GOOGLE_ADS_CONVERSION_ACTION_ID}`;
  const conversionDateTime = formatConversionDateTime(payload.timestamp) || formatConversionDateTime(new Date().toISOString().slice(0, 19).replace('T', ' '));

  const userIdentifiers = [
    { hashed_email: hashEmail(email) },
  ];

  // Add name identifiers if available (improves match rate)
  if (payload?.contact?.firstname && payload?.contact?.lastname) {
    userIdentifiers.push({
      address_info: {
        hashed_first_name: hashName(payload.contact.firstname),
        hashed_last_name: hashName(payload.contact.lastname),
        country_code: 'SE',
      },
    });
  }

  const conversion = {
    conversion_action: conversionAction,
    conversion_date_time: conversionDateTime,
    conversion_value: Number(payload.value || 1),
    currency_code: payload.currency || 'SEK',
    order_id: String(orderId), // Google Ads deduplicates by order_id
    user_identifiers: userIdentifiers,
  };

  // Initialise Google Ads client (uses env vars)
  let client;
  try {
    client = new GoogleAdsApi({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    });
  } catch (err) {
    console.error('Failed to init GoogleAdsApi client:', err);
    return res.status(500).json({ error: 'google_ads_client_init_failed', details: err.message });
  }

  const customer = client.Customer({
    customer_id: process.env.GOOGLE_ADS_CUSTOMER_ID,
    refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    login_customer_id: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || undefined, // set if using manager account
  });

  // Upload click conversion (Enhanced Conversions for Leads format)
  try {
    const response = await customer.conversionUploads.uploadClickConversions(
      [conversion],
      {
        partial_failure: true,
        validate_only: process.env.VALIDATE_ONLY === 'true', // set to true for dry-run
      }
    );

    // Check for partial failures
    if (response?.partial_failure_error) {
      console.error('Partial failure from Google Ads:', JSON.stringify(response.partial_failure_error));
      return res.status(207).json({
        status: 'partial_failure',
        error: response.partial_failure_error,
      });
    }

    console.log('Conversion uploaded successfully:', {
      order_id: orderId,
      email_hash_prefix: hashEmail(email).slice(0, 8),
      conversion_action: conversionAction,
    });

    return res.status(200).json({
      status: 'ok',
      order_id: orderId,
      results: response?.results || [],
    });
  } catch (err) {
    console.error('Failed to upload conversion:', err);
    return res.status(500).json({
      error: 'conversion_upload_failed',
      details: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
  }
}
