import Cerebras from "@cerebras/cerebras_cloud_sdk";
import twilio from "twilio";

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

import type { WSContext } from "hono/ws";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_ACCOUNT_TOKEN;

const TwClient = twilio(accountSid, authToken);
const client = new Cerebras({
  apiKey: process.env.CEREBRAS_API_KEY, // This is the default and can be omitted
});

// Simple in-memory conversation store
let conversation: { role: "system" | "user" | "assistant"; content: string }[] =
  [
    {
      role: "system",
      content: `
You are a friendly and professional receptionist for a dental clinic.
Your responsibilities:
- Greet patients warmly and maintain a helpful, caring tone.
- Help patients book new appointments, reschedule existing ones, or cancel them.
- Always confirm important details like patient name, contact number, date, and time of appointment.
- For rescheduling or cancellations, politely acknowledge and confirm the changes.
- Provide very basic dental guidance (e.g., pain relief tips, hygiene reminders) but avoid medical diagnosis.
- If the question goes beyond your scope, recommend contacting the dentist directly.
- Your Response is getting sended for text to speech model so give answer that is easy to convert like dont give numbers give words instead
- Keep your responses short 
Your goal is to make patients feel comfortable and cared for, while efficiently managing their appointments.
    `,
    },
  ];

// Function that keeps memory
export async function textYeild(msg: string) {
  console.log("User said:", msg);

  // Push user message into memory
  conversation.push({ role: "user", content: msg });

  const response = await client.chat.completions.create({
    messages: conversation,
    model: "llama-4-maverick-17b-128e-instruct",
    stream: false,
    max_tokens: 150,
    temperature: 0.5,
    top_p: 0.9,
  });

  const reply = response.choices[0].message.content ?? "";

  // Store assistant reply in memory
  conversation.push({ role: "assistant", content: reply });

  console.log("Assistant:", reply);
  return reply;
}

export const createCall = async (toNum: string) => {
  try {
    const message = await TwClient.calls.create({
      url: "https://cbc1cea37a84.ngrok-free.app/voice",
      to: "+916280823503",
      from: "+12272323141",
    });
    console.log("Message SID:", message.sid);
  } catch (error) {
    console.error("Error sending message:", error);
  }
};

const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

export const createAudioStreamFromText = async (
  text: string,
  ws: WSContext,
  streamSid: number
): Promise<void> => {
  const audioStream = await elevenlabs.textToSpeech.stream(
    "21m00Tcm4TlvDq8ikWAM",
    {
      modelId: "eleven_turbo_v2_5",
      text,
      outputFormat: "ulaw_8000",
      // Optional voice settings that allow you to customize the output
      voiceSettings: {
        stability: 0,
        similarityBoost: 1.0,
        useSpeakerBoost: true,
        speed: 1.0,
      },
    }
  );

  const chunks: Buffer[] = [];
  for await (const chunk of audioStream) {
    ws.send(
      JSON.stringify({
        streamSid,
        event: "media",
        media: {
          payload: Buffer.from(chunk as any).toString("base64"),
        },
      })
    );
  }
};
