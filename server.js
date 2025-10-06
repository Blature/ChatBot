const express = require("express");
const path = require("path");
const axios = require("axios");
const cors = require("cors");
// Load env file based on NODE_ENV
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
require("dotenv").config({ path: path.join(__dirname, envFile) });

const app = express();
const PORT = process.env.PORT || 3000;


const INSTANCE_ID = process.env.ULTRAMSG_INSTANCE_ID;
const ULTRAMSG_TOKEN = process.env.ULTRAMSG_TOKEN;
const ULTRAMSG_BASE_URL = process.env.ULTRAMSG_BASE_URL;


app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));


const receivedMessages = [];
const sseClients = new Set();

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

  const payload = req.body || {};
  const event = {
    direction: "incoming",
    from: payload.from || payload.sender || payload.phone || null,
    to: payload.to || payload.receiver || null,
    body:
      payload.body ||
      payload.message ||
      payload.text ||
      payload.caption ||
      null,
    type: payload.type || payload.event || null,
    raw: payload,
    at: new Date().toISOString(),
  };

  pushAndBroadcast(event);

  res.json({ received: true });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}/`;
  console.log(`Server running at ${url}`);
});
