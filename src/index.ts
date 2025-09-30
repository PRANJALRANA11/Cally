import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createNodeWebSocket } from "@hono/node-ws";
import { textYeild, createCall } from "./controller.js";
import { PassThrough, Readable } from "stream";
import { AssemblyAI } from "assemblyai";
import WebSocket from "ws";
import type { WSContext } from "hono/ws";

let isSocketOpenEleven = false;
let socketInstanceForTwilio: WSContext;
let streamSid = 0;
const voiceId = "Xb7hH8MSUJpSbSDYk0k2";

const model = "eleven_flash_v2_5";

const uri: string = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=${model}&output_format=ulaw_8000`;

const websocket = new WebSocket(uri, {
  headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY },
});

websocket.on("open", async () => {
  console.log("🔗 ElevenLabs socket opened");
  isSocketOpenEleven = true;
  const beat = setInterval(() => {
    if (websocket.readyState === WebSocket.OPEN) {
      websocket.send(JSON.stringify({ text: " " }));
      console.log("💓 Sent heartbeat");
    }
  }, 20000);
  websocket.send(
    JSON.stringify({
      text: " ",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.8,
        use_speaker_boost: false,
      },
      generation_config: { chunk_length_schedule: [120, 160, 250, 290] },
    })
  );
  websocket.on("close", () => {
    console.log("🔗 ElevenLabs socket closed");
    clearInterval(beat);
    isSocketOpenEleven = false;
  });
});

websocket.on("message", function incoming(event) {
  const data = JSON.parse(event.toString());
  if (data["audio"]) {
    // const audioBuffer: Buffer = Buffer.from(data["audio"], "base64");
    socketInstanceForTwilio.send(
      JSON.stringify({
        streamSid,
        event: "media",
        media: {
          payload: data["audio"],
        },
      })
    );
  }
});

const app = new Hono();

const SttStream = new PassThrough();

const SttClient = new AssemblyAI({
  apiKey: process.env.ASSEMBLY_API_KEY || "",
});

const transcriber = SttClient.streaming.transcriber({
  sampleRate: 8000,
  formatTurns: true,
  encoding: "pcm_mulaw",
});

transcriber.on("open", ({ id }) => {
  console.log(`Session opened with Id: ${id}`);
});

transcriber.on("error", (error) => {
  console.error("Error:", error);
});

transcriber.on("close", (code, reason) => {
  console.log("Session closed:", code, reason);
  websocket.send(JSON.stringify({ text: "" }));
});

transcriber.on("turn", async (turn) => {
  if (!turn.transcript) {
    return;
  }

  if (turn.transcript && turn.end_of_turn) {
    console.log("Final Transcript:", turn.transcript);
    if (isSocketOpenEleven) {
      for await (const chunk of textYeild(turn.transcript)) {
        console.log("LLM stream:", chunk);
        websocket.send(JSON.stringify({ text: chunk }));
      }
    }
  }
});

let buffer = Buffer.alloc(0);
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.get("/make-call", async (c) => {
  let numberToCall: string = c.req.query("number") || "";

  console.log(numberToCall);
  await createCall(numberToCall);
  return c.text("hello");
});

app.post("/voice", async (c) => {
  await transcriber.connect();
  console.log("run");
  const twiml = `
   <Response>
  <Say>This demo application will repeat back what you say. Watch the console to see the media messages. Begin speaking now.</Say>
  <Connect>
    <Stream url="wss://cbc1cea37a84.ngrok-free.app/ws"> 
      <Parameter name="aCutomParameter" value="aCustomValue that was set in TwiML" />
    </Stream>
  </Connect>
  <Say>Thank you! The WebSocket has been closed and the next TwiML verb was reached.</Say>
</Response>
  `;

  return c.text(twiml, 200, { "Content-Type": "application/xml" });
});

app.get(
  "/ws",
  upgradeWebSocket((c) => {
    return {
      onMessage(event, ws) {
        socketInstanceForTwilio = ws;
        // console.log(`Message from client: ${event.data}`);
        const msg = JSON.parse(String(event.data));
        if (msg.event === "start" && msg.start) streamSid = msg.start.streamSid;
        if (msg.event == "media") {
          let base64String = msg.media.payload;

          const chunk = Buffer.from(msg.media.payload, "base64");
          buffer = Buffer.concat([buffer, chunk]);

          // this is to ensure that it audio between 50ms to 100ms or gets 30002 error from assembly
          if (buffer.length >= 800) {
            transcriber.sendAudio(buffer);
            buffer = Buffer.alloc(0); // reset buffer
          }
        }

        ws.send("Hello from server!");
      },
      onClose: () => {
        console.log("Connection closed");
        transcriber.close();
      },
    };
  })
);

const server = serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  }
);
injectWebSocket(server);
