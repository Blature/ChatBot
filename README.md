# WhatsApp Chatbot (UltraMSG + Express)


## Quick Start

1. Install dependencies:

   ```bash
   npm install
   npm start
   ```

2. Open `http://localhost:3000/` to view the chatbot UI.

## Configuration

Environment variables (optional):

- `ULTRAMSG_INSTANCE_ID`
- `ULTRAMSG_TOKEN`
- `ULTRAMSG_BASE_URL`

Create a `.env` file if you want to override defaults.

## Webhook

Configure UltraMSG webhook to POST to your public URL that proxies to `/webhook` on this server (via Nginx). Incoming payloads are stored and streamed via Server-Sent Events at `/events` to the UI.

---
