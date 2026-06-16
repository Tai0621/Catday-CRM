# Catday CRM — Deployment Guide

## Prerequisites
- Vercel account
- Turso account (free tier works)
- Anthropic API key

## 1. Database setup (Turso)

```bash
npm install -g @turso/cli
turso auth login
turso db create catday-crm
turso db show catday-crm   # get DATABASE_URL
turso db tokens create catday-crm  # get DATABASE_AUTH_TOKEN
```

## 2. Run migrations

```bash
cp .env.example .env.local
# Fill in DATABASE_URL and DATABASE_AUTH_TOKEN
npx prisma migrate dev --name init
```

## 3. Seed initial membership tiers

Visit `/memberships/tiers` after first login to create your tiers (e.g. Kitten / Cat / Lion).

## 4. Deploy to Vercel

```bash
npm install -g vercel
vercel --prod
```

Set all environment variables from `.env.example` in Vercel project settings.

## 5. Google Forms webhook setup

In Google Apps Script (bound to your registration form):

```javascript
function onFormSubmit(e) {
  const responses = e.namedValues;
  const payload = {
    phone: responses['Phone Number'][0],
    name: responses['Full Name'][0],
    email: responses['Email'][0],
    marketingConsent: responses['Marketing Consent'][0] === 'Yes',
    cat_1_name: responses['Cat 1 Name'][0],
    cat_1_breed: responses['Cat 1 Breed'][0],
    cat_1_gender: responses['Cat 1 Gender'][0],
    cat_1_lifeStage: responses['Cat 1 Life Stage'][0],
  };

  UrlFetchApp.fetch('https://your-catday-crm.vercel.app/api/google-forms', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-webhook-secret': 'your_forms_secret' },
    payload: JSON.stringify(payload),
  });
}
```

## 6. WhatsApp Cloud API (optional)

1. Create Meta Developer app
2. Set webhook URL: `https://your-catday-crm.vercel.app/api/whatsapp/webhook`
3. Set `WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_APP_SECRET` in Vercel env vars

## 7. TunaiPOS integration (future)

When ready, add TunaiPOS API credentials to `.env` and implement `lib/tunaipos.ts` following the same pattern as `lib/storehub.ts` in the Haiwan CRM.
