# Upsales → Google Ads conversion bridge

Tar emot Upsales trigger-webhook när en Inbound-möte skapas (från Easy Booking på `/boka-demo`), hashar lead-data och postar en Enhanced Conversion for Leads till Google Ads via deras officiella API.

**Stack:** Node.js 20+, Vercel Serverless Function, `google-ads-api` SDK.

**Status:** Färdig kod, behöver Google Ads API-credentials och deployment.

## Vad bridgen gör

1. Upsales fyrar webhook när Mötestyp = Inbound skapas (sätts upp i Upsales triggers, klart).
2. Vercel function tar emot POST på `/api/upsales-webhook?token=SECRET`.
3. Validerar webhook-token, filtrerar på `appointment_type === 'Inbound'` igen som säkerhetscheck.
4. SHA256-hashar email, firstname, lastname (normaliserade till lowercase + trim).
5. Postar till Google Ads `customers.uploadClickConversions` med `user_identifiers` (hashad).
6. Använder `appointment.id` som `order_id` för deduplication (samma bokning räknas aldrig dubbelt).

## Setup-flow

Du behöver fyra saker innan du kan deploya:

1. **Google Ads Developer Token** (1-2 dagars approval)
2. **OAuth2 client** i Google Cloud Console
3. **Refresh token** (genereras lokalt med hjälpscript)
4. **Conversion action ID** för offline conversions

Allt detta beskrivs nedan. Räkna med en halvdag totalt för Jon, exklusive väntetid på developer token.

### Steg 1: Apply för Developer Token

1. Logga in i Google Ads (`tommy@evity.hr`).
2. Gå till **Tools → API Center** (alt direkt: https://ads.google.com/aw/apicenter).
3. Fyll i ansökan. Use case: "Offline conversion upload via our backend".
4. Skicka in. Approval brukar ta 1-2 vardagar.
5. När approved får du en token-sträng. Spara den, det är `GOOGLE_ADS_DEVELOPER_TOKEN`.

### Steg 2: OAuth2 client i Google Cloud Console

1. Gå till https://console.cloud.google.com/.
2. Skapa nytt projekt om Evity inte redan har ett ("evity-google-ads-bridge" funkar).
3. **APIs & Services → Library** → sök "Google Ads API" → Enable.
4. **APIs & Services → OAuth consent screen** → välj "External", fyll i bolagsinfo (app name "Evity Ads Bridge", support email tommy@evity.hr). Lägg till scope `https://www.googleapis.com/auth/adwords`. Lägg till `tommy@evity.hr` som test-användare.
5. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorised redirect URIs: `http://localhost:8888/oauth2/callback`
   - Klicka skapa.
6. Spara `Client ID` och `Client secret` som `GOOGLE_CLIENT_ID` och `GOOGLE_CLIENT_SECRET`.

### Steg 3: Skapa conversion action för offline conversions

Den befintliga `Bokat demo (tag)` vi skapade tidigare är tag-baserad (för site-pixel) och passar inte för API-upload. Skapa en ny offline conversion action:

1. Google Ads → **Tools → Conversions → + Create conversion action**.
2. Välj **Import → Other data sources or CRMs → Track conversions from clicks**.
3. Click-through window: 90 dagar. Engaged-view: 3 dagar. View-through: 1 dag.
4. Category: **Submit lead form** eller **Book appointment** (välj samma som befintliga).
5. Conversion name: `Bokat demo (Upsales API)`.
6. Value: Use the same value for each conversion → SEK 1.
7. Count: One.
8. Attribution: Data-driven.
9. **Markera som primary action** för bidding.
10. **Aktivera Enhanced Conversions for Leads** på account-nivå:
    - Tools → Conversions → Settings → Customer data terms (acceptera).
    - Hitta din nya conversion action, klicka in, scrolla till "Enhanced Conversions" → toggle on → välj "Google Ads API" som upload method.
11. Klicka Save.
12. Notera **Conversion ID** (10 siffror, samma som tidigare: `11072144698`) och **Conversion Action ID** (lokala ID:t för just denna action). Hitta i URL när du tittar på conversion-detaljen: `...ctId=XXXXXXX` är `GOOGLE_ADS_CONVERSION_ACTION_ID`.

### Steg 4: Generera refresh token lokalt

1. Klona det här repot på din dator.
2. `cp .env.example .env` och fyll i `GOOGLE_CLIENT_ID` och `GOOGLE_CLIENT_SECRET` från steg 2.
3. `npm install`
4. `npm run generate-refresh-token`
5. En browser öppnas (eller besök URL:n manuellt). Logga in med `tommy@evity.hr`. Godkänn.
6. Terminalen printar `GOOGLE_ADS_REFRESH_TOKEN=ya29....`
7. Lägg in den i `.env`.

Refresh tokens går ut om de inte används på 6 månader, men annars är de eviga. Du gör detta steg en gång.

### Steg 5: Fyll i .env helt

```env
GOOGLE_ADS_DEVELOPER_TOKEN=från-steg-1
GOOGLE_CLIENT_ID=från-steg-2
GOOGLE_CLIENT_SECRET=från-steg-2
GOOGLE_ADS_REFRESH_TOKEN=från-steg-4
GOOGLE_ADS_CUSTOMER_ID=8881582541
GOOGLE_ADS_CONVERSION_ACTION_ID=från-steg-3
WEBHOOK_SHARED_SECRET=`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
VALIDATE_ONLY=true
```

Notera `VALIDATE_ONLY=true` för första testet. Detta validerar payload mot Google Ads API utan att faktiskt skapa konvertering. Sätt till `false` när du är redo att skicka skarpt.

### Steg 6: Testa lokalt

```bash
npm run dev
# i annan terminal:
node scripts/test-webhook.js
```

Du ska se status 200 och en mock-konvertering loggas. Om Google Ads avvisar payloaden får du detaljerat felmeddelande.

### Steg 7: Deploya till Vercel

```bash
npm install -g vercel
vercel login
vercel link
vercel env add GOOGLE_ADS_DEVELOPER_TOKEN
# upprepa för alla env vars i .env.example
vercel --prod
```

Du får en URL typ `https://upsales-google-ads-bridge.vercel.app`.

### Steg 8: Sätt VALIDATE_ONLY=false när du är redo

```bash
vercel env rm VALIDATE_ONLY production
vercel env add VALIDATE_ONLY production
# skriv: false
vercel --prod
```

### Steg 9: Uppdatera Upsales webhook-URL

1. Gå till Upsales → Inställningar → Affärsregler → Triggers.
2. Öppna "Google Ads Conversion - Demo Booked".
3. Edit Skicka webhook → URL: `https://upsales-google-ads-bridge.vercel.app/api/upsales-webhook?token=DIN_SHARED_SECRET`.
4. Spara.

### Steg 10: Verifiera end-to-end

1. Gör en testbokning via `https://www.evity.hr/boka-demo`.
2. Kolla Vercel function logs: du ska se "Conversion uploaded successfully".
3. Vänta 6-12 timmar.
4. Google Ads → Tools → Conversions → "Bokat demo (Upsales API)" ska visa 1 conversion med "Recorded" status.

## Felsökning

**"Authentication failed"**: Refresh token ogiltig, kör om Steg 4.

**"Invalid customer ID"**: `GOOGLE_ADS_CUSTOMER_ID` ska vara 10 siffror utan dashes. Evity är `8881582541`.

**"Customer not enabled for API access"**: Developer token inte approved än. Vänta.

**"Partial failure: Email format invalid"**: Vår normalisering misslyckas på något ovanligt email. Lägg till logging och kolla payload.

**Conversion syns inte i Google Ads**: Vänta 12 timmar. Conversion processing-tid är 3-9 timmar normalt.

## Säkerhet

- Webhook authenticated via shared secret i URL eller `X-Webhook-Token` header.
- Inga raw emails loggas, bara hash-prefix för debug.
- Vercel env vars är encrypted at rest.
- Tilt: Lägg till IP allowlist via Vercel om Upsales publicerar sina webhook-IPs.

## Vidareutveckling (framtida)

- **Meta CAPI**: Samma payload kan postas till Meta Conversions API genom att lägga till en till POST i samma handler.
- **LinkedIn CAPI**: Samma, deras Lead Sync API tar liknande hashad data.
- **GCLID-attribution**: Lägg till hidden field i Upsales bokningsformulär som fångar GCLID från landing page cookie (kräver Upsales Easy Booking custom field support).
- **Slack-notifiering**: Lägg till en POST till Slack webhook efter lyckad conversion så säljteamet ser realtids-leads.
