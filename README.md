# Multi-Channel Chatbot (WhatsApp · Instagram · Bale)

Simple Express-based chatbot that integrates three channels:
- WhatsApp via UltraMSG
- Instagram via SendPulse
- Bale via `tapi.bale.ai`

It provides a clean web UI (served from `public/index.html`) with tabs for WhatsApp, Instagram, and Bale, and streams incoming/outgoing events via Server-Sent Events (SSE).

## Quick Start

1) Install dependencies and start dev

```bash
npm install
npm start
```

2) Open `http://localhost:3000/` (or your chosen `PORT`) to use the UI.

## Environment Variables

This project loads env from `.env` by default, and from `.env.production` when `NODE_ENV=production`.

Core
- `PORT` – Server port (default: `3000`)
- `NODE_ENV` – `production` uses `.env.production`; anything else uses `.env`

WhatsApp (UltraMSG)
- `ULTRAMSG_INSTANCE_ID` – Your UltraMSG instance ID
- `ULTRAMSG_TOKEN` – API token from UltraMSG
- `ULTRAMSG_BASE_URL` – Base URL for UltraMSG API (e.g. `https://api.ultramsg.com`)

Instagram (SendPulse)
- `SENDPULSE_CLIENT_ID` – OAuth client id
- `SENDPULSE_CLIENT_SECRET` – OAuth client secret

Bale
- `BALE_TOKEN` – Bot token from Bale
- `BALE_API_BASE` – Base URL for Bale API (default: `https://tapi.bale.ai`)
- `BALE_WEBHOOK_URL` – Public URL pointing to your server’s Bale webhook path (`/bale/webhook`)

## Webhook Setup

Public HTTPS domain is recommended. Use a reverse proxy (like Nginx) to forward public requests to your running node server.

WhatsApp (UltraMSG)
- Configure UltraMSG’s webhook to POST to: `https://<your-domain>/whatsapp/webhook`
- Purpose: Receives incoming WhatsApp messages and logs them to the UI via SSE.

Instagram (SendPulse)
- If using inbound updates from SendPulse, configure webhook to POST to: `https://<your-domain>/instagram/webhook`
- Purpose: Receives incoming Instagram messages and logs them to the UI via SSE.

Bale
- Endpoint to receive messages: `https://<your-domain>/bale/webhook`
- Webhook registration:
  - Automatically called on server startup if `BALE_WEBHOOK_URL` is set
  - Manually call: `POST /bale/webhook/set` with JSON body `{ "url": "https://<your-domain>/bale/webhook" }`
  - Check status: `GET /bale/webhook/info`
- Purpose: Receives Bale bot updates; logs and stores `chat_id` in memory for sending messages.

## API Endpoints

Common
- `GET /events` – Server-Sent Events stream for UI logs
- `GET /health` – Basic health check

WhatsApp
- `POST /send` – Send message
  - Body: `{ "to": "<phone with country code>", "body": "<text>" }`
- `POST /whatsapp/webhook` – Incoming WhatsApp updates from UltraMSG

Instagram
- `GET /instagram/bots` – List bots from SendPulse (filters Instagram)
- `POST /instagram/send` – Send message to an Instagram contact via SendPulse
  - Body: `{ "contact_id": "<id>", "message": "<text>" }`
- `POST /instagram/webhook` – Incoming Instagram updates from SendPulse

Bale
- `GET /bale/subscribers` – Contacts seen via Bale webhook (`chat_id`, `name`, `username`)
- `POST /bale/send` – Send message to a Bale contact
  - Body: `{ "contact_id": "<chat_id>", "message": "<text>" }`
- `POST /bale/webhook/set` – Register webhook to the Bale API
  - Body: `{ "url": "https://<your-domain>/bale/webhook" }` (or set `BALE_WEBHOOK_URL`)
- `GET /bale/webhook/info` – Get webhook registration info from Bale
- `POST /bale/webhook` – Incoming Bale updates

## UI Usage

- WhatsApp tab: enter phone and message and click Send
- Instagram tab: load subscribers and send messages to selected contact
- Bale tab: view subscribers (from recent webhook updates) and send messages by `chat_id`
- Live logs: all incoming/outgoing events appear with platform badges

## Deployment Notes

Recommended Nginx proxy snippets (adjust host/port):

```
location /whatsapp/webhook { proxy_pass http://localhost:3000/whatsapp/webhook; }
location /instagram/webhook { proxy_pass http://localhost:3000/instagram/webhook; }
location /bale/webhook { proxy_pass http://localhost:3000/bale/webhook; }
```

## Logging

- Startup logs show SendPulse token initialization and Bale webhook registration
- Incoming webhook logs are single-line JSON for easy ingestion
- SSE feeds the UI with normalized events

## Notes

- Eitaa support has been removed based on current project scope.
