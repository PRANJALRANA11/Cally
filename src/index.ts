import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createNodeWebSocket } from "@hono/node-ws";
import { textYeild, createCall } from "./controller.js";
import { PassThrough, Readable } from "stream";
import { AssemblyAI } from "assemblyai";

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
  console.log(`Session opened with ID: ${id}`);
});

transcriber.on("error", (error) => {
  console.error("Error:", error);
});

transcriber.on("close", (code, reason) =>
  console.log("Session closed:", code, reason)
);

transcriber.on("turn", async (turn) => {
  if (!turn.transcript) {
    return;
  }

  if (turn.transcript && turn.end_of_turn) {
    console.log("Final Transcript:", turn.transcript);
    for await (const chunk of textYeild(turn.transcript)) {
      console.log("LLM stream:", chunk);
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
        // console.log(`Message from client: ${event.data}`);
        const msg = JSON.parse(event.data);
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
