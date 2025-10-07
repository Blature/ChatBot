const express = require("express");
const path = require("path");
const axios = require("axios");
const cors = require("cors");
// Load env file based on NODE_ENV
const envFile =
  process.env.NODE_ENV === "production" ? ".env.production" : ".env";
require("dotenv").config({ path: path.join(__dirname, envFile) });

const app = express();
const PORT = process.env.PORT || 3000;

// UltraMSG (WhatsApp) configuration
const INSTANCE_ID = process.env.ULTRAMSG_INSTANCE_ID;
const ULTRAMSG_TOKEN = process.env.ULTRAMSG_TOKEN;
const ULTRAMSG_BASE_URL = process.env.ULTRAMSG_BASE_URL;

// SendPulse (Instagram) configuration
const SENDPULSE_CLIENT_ID = process.env.SENDPULSE_CLIENT_ID;
const SENDPULSE_CLIENT_SECRET = process.env.SENDPULSE_CLIENT_SECRET;
const SENDPULSE_BASE_URL = "https://api.sendpulse.com";

let sendpulseToken = null;
let tokenExpiry = null;

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const receivedMessages = [];
const sseClients = new Set();

// SendPulse token management
async function getSendPulseToken() {
  if (sendpulseToken && tokenExpiry && Date.now() < tokenExpiry) {
    return sendpulseToken;
  }

  try {
    const response = await axios.post(
      `${SENDPULSE_BASE_URL}/oauth/access_token`,
      {
        grant_type: "client_credentials",
        client_id: SENDPULSE_CLIENT_ID,
        client_secret: SENDPULSE_CLIENT_SECRET,
      }
    );

    sendpulseToken = response.data.access_token;
    tokenExpiry = Date.now() + response.data.expires_in * 1000 - 60000; // 1 minute buffer
    console.log("SendPulse: Token acquired successfully");
    return sendpulseToken;
  } catch (error) {
    console.error(
      "SendPulse: Failed to get token:",
      error.response?.data || error.message
    );
    throw error;
  }
}

// SendPulse API request helper
async function spRequest(method, endpoint, data = null) {
  const token = await getSendPulseToken();
  const config = {
    method,
    url: `${SENDPULSE_BASE_URL}${endpoint}`,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };

  if (data) {
    config.data = data;
  }

  try {
    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.error(
      `SendPulse API Error (${method} ${endpoint}):`,
      error.response?.data || error.message
    );
    throw error;
  }
}

function pushAndBroadcast(event) {
  receivedMessages.push(event);
  if (receivedMessages.length > 200) receivedMessages.shift();
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    res.write(payload);
  }
}

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  for (const msg of receivedMessages) {
    res.write(`data: ${JSON.stringify(msg)}\n\n`);
  }

  sseClients.add(res);
  req.on("close", () => {
    sseClients.delete(res);
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, instance: INSTANCE_ID });
});

app.post("/send", async (req, res) => {
  try {
    const { to, body } = req.body;
    if (!to || !body) {
      return res
        .status(400)
        .json({ error: "Parameters 'to' and 'body' are required." });
    }

    const url = `${ULTRAMSG_BASE_URL}/${INSTANCE_ID}/messages/chat`;
    const params = new URLSearchParams();
    params.append("token", ULTRAMSG_TOKEN);
    params.append("to", to);
    params.append("body", body);

    const response = await axios.post(url, params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    pushAndBroadcast({
      direction: "outgoing",
      to,
      body,
      providerResponse: response.data,
      at: new Date().toISOString(),
    });

    res.json({ ok: true, result: response.data });
  } catch (err) {
    const status = err.response?.status || 500;
    const data = err.response?.data || { error: err.message };
    res.status(status).json({ ok: false, error: data });
  }
});

app.post("/webhook", (req, res) => {
  // Normalize incoming payload for different UltraMSG formats
  const payload = req.body || {};
  const nested = payload.data || payload.message || payload.payload || {};
  const arrMsg =
    Array.isArray(payload.messages) && payload.messages.length
      ? payload.messages[0]
      : null;

  const from =
    payload.from ||
    payload.sender ||
    payload.phone ||
    nested.from ||
    (arrMsg && (arrMsg.from || arrMsg.sender)) ||
    null;
  const to =
    payload.to ||
    payload.receiver ||
    nested.to ||
    (arrMsg && (arrMsg.to || arrMsg.receiver)) ||
    null;
  const body =
    payload.body ||
    payload.message ||
    payload.text ||
    payload.caption ||
    nested.body ||
    nested.message ||
    nested.text ||
    (arrMsg && (arrMsg.body || arrMsg.text || arrMsg.message)) ||
    null;
  const type =
    payload.type ||
    payload.event ||
    nested.type ||
    (arrMsg && arrMsg.type) ||
    null;

  const event = {
    direction: "incoming",
    platform: "whatsapp", // This is WhatsApp webhook
    from: from || "Unknown",
    to,
    body: body || "[No text]",
    type,
    raw: payload,
    at: new Date().toISOString(),
  };

  pushAndBroadcast(event);

  res.json({ received: true });
});

// Instagram bots endpoint
app.get("/instagram/bots", async (req, res) => {
  try {
    const bots = await spRequest("GET", "/chatbots/bots");
    console.log("All bots response:", JSON.stringify(bots, null, 2));

    if (bots && bots.data) {
      console.log(
        "Available bots:",
        bots.data.map((bot) => ({
          id: bot.id,
          name: bot.name,
          channel: bot.channel,
          type: bot.type,
          status: bot.status,
        }))
      );

      // Filter Instagram bots - check for case-insensitive matches
      const instagramBots = bots.data.filter(
        (bot) =>
          (bot.channel && bot.channel.toLowerCase() === "instagram") ||
          (bot.type && bot.type.toLowerCase() === "instagram") ||
          (bot.name && bot.name.toLowerCase().includes("instagram"))
      );

      console.log("Filtered Instagram bots:", instagramBots);
      res.json({ ok: true, bots: instagramBots });
    } else {
      console.log("No bots data received");
      res.json({ ok: true, bots: [] });
    }
  } catch (error) {
    console.error(
      "Instagram bots error:",
      error.response?.data || error.message
    );
    res
      .status(500)
      .json({ ok: false, error: error.response?.data || error.message });
  }
});

// Instagram subscribers endpoint
app.get("/instagram/subscribers", async (req, res) => {
  try {
    // First get Instagram bots to find bot_id
    const bots = await spRequest("GET", "/chatbots/bots");
    console.log("Bots for subscribers:", JSON.stringify(bots, null, 2));
    let botId = null;

    if (bots && bots.data) {
      console.log(
        "Looking for Instagram bot in:",
        bots.data.map((bot) => ({
          id: bot.id,
          name: bot.name,
          channel: bot.channel,
          type: bot.type,
        }))
      );

      // Find Instagram bot - check for case-insensitive matches
      const instagramBot = bots.data.find(
        (bot) =>
          (bot.channel && bot.channel.toLowerCase() === "instagram") ||
          (bot.type && bot.type.toLowerCase() === "instagram") ||
          (bot.name && bot.name.toLowerCase().includes("instagram"))
      );

      if (instagramBot) {
        botId = instagramBot.id;
        console.log("Instagram bot found:", instagramBot.name, "ID:", botId);
      } else {
        console.log("No Instagram bot found in available bots");
      }
    }

    if (!botId) {
      console.log("No Instagram bot found");
      return res.json({
        ok: true,
        subscribers: [],
        message: "No Instagram bot configured",
      });
    }

    // Get Instagram contacts from SendPulse with bot_id
    console.log("Fetching contacts with bot_id:", botId);
    const contacts = await spRequest(
      "GET",
      `/instagram/contacts?bot_id=${botId}`
    );
    console.log("Contacts response:", JSON.stringify(contacts, null, 2));

    if (contacts && contacts.data) {
      const subscribers = contacts.data.map((contact) => ({
        contact_id: contact.id,
        name:
          contact.channel_data?.name ||
          contact.channel_data?.first_name +
            " " +
            contact.channel_data?.last_name ||
          null,
        username: contact.channel_data?.user_name || null,
        avatar: contact.channel_data?.profile_pic || null,
        is_verified: contact.channel_data?.is_verified_user || false,
        follower_count: contact.channel_data?.follower_count || 0,
        last_activity: contact.last_activity_at,
      }));

      console.log("Processed subscribers:", subscribers);
      res.json({ ok: true, subscribers });
    } else {
      console.log("No contacts data received");
      res.json({ ok: true, subscribers: [] });
    }
  } catch (error) {
    console.error(
      "Instagram subscribers error:",
      error.response?.data || error.message
    );
    res
      .status(500)
      .json({ ok: false, error: error.response?.data || error.message });
  }
});

// Instagram send message endpoint
app.post("/instagram/send", async (req, res) => {
  try {
    const { contact_id, message } = req.body;

    if (!contact_id || !message) {
      return res.status(400).json({
        ok: false,
        error: "Parameters 'contact_id' and 'message' are required.",
      });
    }

    // First get Instagram bots to find bot_id
    const bots = await spRequest("GET", "/chatbots/bots");
    let botId = null;

    if (bots && bots.data) {
      // Find Instagram bot - check for case-insensitive matches
      const instagramBot = bots.data.find(
        (bot) =>
          (bot.channel && bot.channel.toLowerCase() === "instagram") ||
          (bot.type && bot.type.toLowerCase() === "instagram") ||
          (bot.name && bot.name.toLowerCase().includes("instagram"))
      );

      if (instagramBot) {
        botId = instagramBot.id;
        console.log("Instagram send: using bot_id", botId);
      }
    }

    if (!botId) {
      return res.status(400).json({
        ok: false,
        error: "No Instagram bot configured",
      });
    }

    // Send message via SendPulse Instagram API with bot_id
    const result = await spRequest("POST", "/instagram/contacts/send", {
      contact_id,
      messages: [
        {
          type: "text",
          message: {
            text: message,
          },
        },
      ],
      bot_id: botId,
    });

    // Broadcast the outgoing message
    pushAndBroadcast({
      direction: "outgoing",
      to: contact_id,
      body: message,
      platform: "instagram",
      providerResponse: result,
      at: new Date().toISOString(),
    });

    res.json({ ok: true, result });
  } catch (error) {
    console.error(
      "Instagram send error:",
      error.response?.data || error.message
    );
    const status = error.response?.status || 500;
    const data = error.response?.data || { error: error.message };
    res.status(status).json({ ok: false, error: data });
  }
});

// Instagram webhook endpoint
app.post("/instagram/webhook", (req, res) => {
  try {
    console.log(req);
    const payload = req.body || {};
    console.log(
      "Instagram webhook received:",
      JSON.stringify(payload, null, 2)
    );

    // Try multiple possible field names for SendPulse Instagram webhook
    const contact_id =
      payload.contact_id ||
      payload.from ||
      payload.sender_id ||
      payload.user_id ||
      (payload.contact && payload.contact.id) ||
      (payload.sender && payload.sender.id) ||
      null;

    const message =
      payload.message ||
      payload.text ||
      payload.body ||
      payload.content ||
      (payload.message_data && payload.message_data.text) ||
      (payload.data && payload.data.message) ||
      null;

    const message_type =
      payload.message_type || payload.type || payload.event_type || "text";

    // Try to get user info for better display
    const username =
      payload.username ||
      (payload.contact && payload.contact.username) ||
      (payload.sender && payload.sender.username) ||
      null;

    const name =
      payload.name ||
      (payload.contact && payload.contact.name) ||
      (payload.sender && payload.sender.name) ||
      null;

    console.log("Parsed webhook data:", {
      contact_id,
      message,
      message_type,
      username,
      name,
    });

    const displayName = name || username || contact_id || "Unknown";

    const event = {
      direction: "incoming",
      from: displayName,
      to: null,
      body: message || "[No text]",
      type: message_type,
      platform: "instagram",
      raw: payload,
      at: new Date().toISOString(),
    };

    console.log("Broadcasting Instagram event:", event);
    pushAndBroadcast(event);
    res.json({ received: true });
  } catch (error) {
    console.error("Instagram webhook error:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, async () => {
  const url = `http://localhost:${PORT}/`;
  console.log(`Server running at ${url}`);

  // Initialize SendPulse token on startup
  try {
    await getSendPulseToken();
    console.log("SendPulse: Initialized successfully");
  } catch (error) {
    console.error("SendPulse: Failed to initialize:", error.message);
  }
});
