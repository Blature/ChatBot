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
    const { to, message } = req.body;
    
    const bots = await spRequest("GET", "/chatbots/bots");
    const instagramBot = bots.data.find(
      (bot) => bot.channel === "INSTAGRAM" && bot.status === "active"
    );

    if (!instagramBot) {
      return res.status(404).json({ error: "No Instagram bot found" });
    }

    const botId = instagramBot.id;
    const result = await spRequest("POST", "/instagram/contacts/send", {
      contact_id: to,
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

    const event = {
      direction: "outgoing",
      platform: "instagram",
      from: "U",
      to,
      body: message,
      type: "text",
      at: new Date().toISOString(),
    };

    pushAndBroadcast(event);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/webhook", (req, res) => {
  // Check if this is actually an Instagram message
  const payload = req.body || {};
  const isInstagram = Array.isArray(payload) && payload.length > 0 && 
                     (payload[0].service === "instagram" || payload[0].bot?.channel === "INSTAGRAM");
  
  if (isInstagram) {
    const instagramData = payload[0];
    const contact = instagramData.contact || {};
    const messageData = instagramData.info?.message?.channel_data?.message || {};
    
    const event = {
      direction: "incoming",
      platform: "instagram",
      from: contact.name || contact.username || "Unknown",
      username: contact.username || null,
      photo: contact.photo || null,
      body: messageData.text || contact.last_message || "[No text]",
      type: "text",
      raw: payload,
      at: new Date().toISOString(),
    };

    pushAndBroadcast(event);
    res.status(200).json({ ok: true });
    return;
  }

  // Handle regular WhatsApp messages
  // Normalize incoming payload for different UltraMSG formats
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
    platform: "whatsapp",
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

app.get("/bots", async (req, res) => {
  try {
    const bots = await spRequest("GET", "/chatbots/bots");
    
    const instagramBots = bots.data.filter(
      (bot) => bot.channel === "INSTAGRAM" && bot.status === "active"
    );

    res.json({ bots: instagramBots });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/subscribers", async (req, res) => {
  try {
    const bots = await spRequest("GET", "/chatbots/bots");
    
    const instagramBot = bots.data.find(
      (bot) => bot.channel === "INSTAGRAM" && bot.status === "active"
    );

    if (!instagramBot) {
      return res.status(404).json({ error: "No Instagram bot found" });
    }

    const botId = instagramBot.id;
    const contacts = await spRequest(
      "GET",
      `/instagram/contacts?bot_id=${botId}`
    );
    
    const subscribers = contacts.data.map((contact) => ({
      id: contact.id,
      name: contact.channel_data?.name ||
        contact.channel_data?.first_name +
          " " +
          contact.channel_data?.last_name ||
        contact.channel_data?.user_name ||
        "Unknown",
      username: contact.channel_data?.user_name || null,
      photo: contact.channel_data?.profile_pic || null,
      last_message: contact.last_message,
      last_activity: contact.last_activity_at,
    }));

    res.json({ subscribers });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
  const payload = req.body || {};
  
  const contact_id = payload.contact_id || payload.from || payload.sender_id || payload.user_id;
  const message = payload.message || payload.text || payload.body || payload.content;
  const message_type = payload.message_type || payload.type || "text";
  const username = payload.username || payload.name || (payload.contact && payload.contact.username);
  const name = payload.name || (payload.contact && payload.contact.name) || (payload.sender && payload.sender.name);

  const displayName = name || username || contact_id || "Unknown";

  const event = {
    direction: "incoming",
    platform: "instagram",
    from: displayName,
    username: username || null,
    photo: payload.photo || (payload.contact && payload.contact.photo) || null,
    body: message || "[No text]",
    type: message_type,
    raw: payload,
    at: new Date().toISOString(),
  };

  pushAndBroadcast(event);
  res.status(200).json({ ok: true });
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
