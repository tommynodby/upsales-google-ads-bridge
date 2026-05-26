// One-time helper to generate a Google Ads API refresh token via OAuth2 flow.
// Run: node scripts/generate-refresh-token.js
// Then follow the printed URL, sign in with the Google account that owns the Google Ads account,
// authorise, and paste the code back into the terminal.

import http from 'node:http';
import { URL } from 'node:url';
import { spawn } from 'node:child_process';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:8888/oauth2/callback';
const SCOPE = 'https://www.googleapis.com/auth/adwords';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your environment before running.');
  console.error('Example: GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy node scripts/generate-refresh-token.js');
  process.exit(1);
}

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPE);
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');

console.log('\n=== Google Ads API refresh token generator ===\n');
console.log('Opening this URL in your browser:\n');
console.log(authUrl.toString());
console.log('\nSign in with the Google account that has access to the Google Ads account, then approve.');
console.log('Waiting for the OAuth callback on http://localhost:8888 ...\n');

// Try to open browser automatically
const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
spawn(openCmd, [authUrl.toString()], { detached: true, stdio: 'ignore' }).unref();

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://localhost:8888`);
  if (reqUrl.pathname !== '/oauth2/callback') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const code = reqUrl.searchParams.get('code');
  if (!code) {
    res.writeHead(400);
    res.end('Missing code parameter');
    return;
  }

  try {
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenResp.json();

    if (tokens.refresh_token) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html><body style="font-family:sans-serif; padding:32px;">
        <h1>Got refresh token. You can close this tab.</h1>
        <p>Check your terminal.</p>
        </body></html>
      `);
      console.log('\n=== SUCCESS ===\n');
      console.log('Refresh token:\n');
      console.log(tokens.refresh_token);
      console.log('\nAdd this to your .env file as:');
      console.log(`GOOGLE_ADS_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    } else {
      res.writeHead(500);
      res.end('Did not receive a refresh token. Check terminal.');
      console.error('\nDid not receive refresh_token. Full response:', tokens);
    }
  } catch (err) {
    console.error('Token exchange failed:', err);
    res.writeHead(500);
    res.end('Token exchange failed: ' + err.message);
  } finally {
    setTimeout(() => server.close(), 1000);
  }
});

server.listen(8888);
