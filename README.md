# WhatsApp Chatbot (UltraMSG + Express)

Persian guide below.

## Quick Start

1. Install dependencies:

   ```bash
   npm install
   npm start
   ```

2. Open `http://localhost:3000/` to view the chatbot UI.

## Configuration

Environment variables (optional):

- `ULTRAMSG_INSTANCE_ID` (default: `instance143014`)
- `ULTRAMSG_TOKEN` (default: `92a15l4vu9y8f4zb`)
- `ULTRAMSG_BASE_URL` (default: `https://api.ultramsg.com`)

Create a `.env` file if you want to override defaults.

## Webhook

Configure UltraMSG webhook to POST to your public URL that proxies to `/webhook` on this server (via Nginx). Incoming payloads are stored and streamed via Server-Sent Events at `/events` to the UI.

---

## راه‌اندازی سریع (فارسی)

1. نصب وابستگی‌ها و اجرای سرور:

   ```powershell
   npm install
   npm start
   ```

2. صفحه را در `http://localhost:3000/` باز کنید.

## تنظیمات

می‌توانید مقادیر زیر را در فایل `.env` تنظیم کنید:

- `ULTRAMSG_INSTANCE_ID` پیش‌فرض: `instance143014`
- `ULTRAMSG_TOKEN` پیش‌فرض: `92a15l4vu9y8f4zb`
- `ULTRAMSG_BASE_URL` پیش‌فرض: `https://api.ultramsg.com`

## وب‌هوک

وب‌هوک UltraMSG را به مسیر عمومی‌ای که توسط Nginx به `/webhook` این سرویس ارجاع داده می‌شود تنظیم کنید. تمام پیام‌های ورودی ثبت شده و به صورت زنده از مسیر `/events` به رابط کاربری ارسال می‌شوند.