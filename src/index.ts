import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createNodeWebSocket } from "@hono/node-ws";
import { textYeild, createCall } from "./controller.js";
import { PassThrough, Readable } from "stream";
import { AssemblyAI } from "assemblyai";

import fs from "fs";
const app = new Hono();

const SttStream = new PassThrough();

const SttClient = new AssemblyAI({
  apiKey: process.env.ASSEMBLY_API_KEY || "",
});

const transcriber = SttClient.streaming.transcriber({
  sampleRate: 8000,
  formatTurns: true,
});

transcriber.on("open", ({ id }) => {
  console.log(`Session opened with ID: ${id}`);
});

transcriber.on("error", (error) => {
  console.error("Error:", error);
});

transcriber.on("close", (code, reason) =>
  console.log("Session closed:", code, reason)
);

transcriber.on("turn", (turn) => {
  if (!turn.transcript) {
    return;
  }

  console.log("Turn:", turn.transcript);
});

let buffer = Buffer.alloc(0);

const fileStream = fs.createWriteStream("output.txt", { flags: "a" });
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
    Readable.toWeb(SttStream).pipeTo(transcriber.stream());
    return {
      onMessage(event, ws) {
        // console.log(`Message from client: ${event.data}`);
        const msg = JSON.parse(event.data);
        if (msg.event == "media") {
          let base64String = msg.media.payload;

          const chunk = Buffer.from(msg.media.payload, "base64");
          buffer = Buffer.concat([buffer, chunk]);
          writeWav(buffer, "test.wav");

          if (buffer.length >= 800) {
            console.log("this should run");
            SttStream.write(buffer);
            buffer = Buffer.alloc(0); // reset buffer
          }
        }

        ws.send("Hello from server!");
      },
      onClose: () => {
        console.log("Connection closed");
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

function writeWav(buffer, filePath, sampleRate = 8000) {
  const header = Buffer.alloc(44);

  // RIFF header
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + buffer.length, 4);
  header.write("WAVE", 8);

  // fmt chunk
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM
  header.writeUInt16LE(1, 20); // Linear PCM
  header.writeUInt16LE(1, 22); // Mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample

  // data chunk
  header.write("data", 36);
  header.writeUInt32LE(buffer.length, 40);

  const wav = Buffer.concat([header, buffer]);
  fs.writeFileSync(filePath, wav);
}
