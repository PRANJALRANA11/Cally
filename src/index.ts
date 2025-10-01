import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createNodeWebSocket } from "@hono/node-ws";
import {
  textYeild,
  createCall,
  createAudioStreamFromText,
} from "./controller.js";

import { AssemblyAI } from "assemblyai";
import type { WSContext } from "hono/ws";
import { delay } from "../helper.js";

let isSocketOpenEleven = false;
let prevTurnOrder = 5;
let streamSid = 0;
const voiceId = "Xb7hH8MSUJpSbSDYk0k2";
let twilioWs: WSContext;
const model = "eleven_flash_v2_5";

const app = new Hono();

const SttClient = new AssemblyAI({
  apiKey: process.env.ASSEMBLY_API_KEY || "",
});

const transcriber = SttClient.streaming.transcriber({
  sampleRate: 8000,
  formatTurns: true,
  encoding: "pcm_mulaw",
  endOfTurnConfidenceThreshold: 0.5,
});

transcriber.on("open", ({ id }) => {
  console.log(`Session opened with Id: ${id}`);
});

transcriber.on("error", (error) => {
  console.error("Error:", error);
});

transcriber.on("close", (code, reason) => {
  console.log("Session closed:", code, reason);
});

transcriber.on("turn", async (turn) => {
  if (!turn.transcript) {
    return;
  }
  await delay(0.5);

  if (turn.transcript && turn.end_of_turn && turn.turn_order != prevTurnOrder) {
    prevTurnOrder = turn.turn_order;
    console.log("Final Transcript:", turn.transcript, turn.turn_order);
    const generatedText = await textYeild(turn.transcript);

    createAudioStreamFromText(generatedText, twilioWs, streamSid);
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
 
  <Connect>
    <Stream url="wss://cbc1cea37a84.ngrok-free.app/ws"> 
      <Parameter name="aCutomParameter" value="aCustomValue that was set in TwiML" />
    </Stream>
  </Connect>
  
</Response>
  `;

  return c.text(twiml, 200, { "Content-Type": "application/xml" });
});

app.get(
  "/ws",
  upgradeWebSocket((c) => {
    return {
      onMessage(event, ws) {
        twilioWs = ws;
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
