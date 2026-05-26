// Posts a sample Upsales payload to your local endpoint for testing.
// Usage:
//   1. Start dev server in another terminal: npm run dev
//   2. Run: node scripts/test-webhook.js
//   3. Watch dev server logs to see if Google Ads accepts the conversion

const ENDPOINT = process.env.ENDPOINT || 'http://localhost:3000/api/upsales-webhook';
const TOKEN = process.env.WEBHOOK_SHARED_SECRET || '';

// Sample payload matching exactly what Upsales sends (captured from webhook.site test)
const samplePayload = {
  event_name: 'appointment_created',
  source: 'upsales',
  appointment: {
    id: `test-${Date.now()}`,
    description: 'Test from test-webhook.js script',
    date: new Date().toISOString().slice(0, 10),
    start_time: '11:00',
    end_time: '12:00',
    user_id: '0',
    participants_names: 'Henrik Hetta',
    appointment_type: 'Inbound',
  },
  contact: {
    email: 'test.cowork@example.com',
    firstname: 'Test',
    lastname: 'Cowork',
    name: 'Test Cowork',
    title: '',
    client_id: '0',
  },
  client: {
    name: 'Test Cowork AB',
    assigned_user_name: 'Henrik Hetta',
  },
  currency: 'SEK',
  value: 1,
  timestamp: new Date().toISOString().slice(0, 19).replace('T', ' '),
};

const url = TOKEN ? `${ENDPOINT}?token=${TOKEN}` : ENDPOINT;

console.log('POSTing to:', url);
console.log('Payload:', JSON.stringify(samplePayload, null, 2));

const resp = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(samplePayload),
});

const body = await resp.text();
console.log(`\nStatus: ${resp.status}`);
console.log('Response:', body);
