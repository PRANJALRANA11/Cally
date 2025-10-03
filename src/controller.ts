import Cerebras from "@cerebras/cerebras_cloud_sdk";
import twilio from "twilio";
import { twilioWs } from "./index.js";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

import type { WSContext } from "hono/ws";

import {
  bookAppointment,
  cancelAppointment,
  rescheduleAppointment,
  checkAvailability,
} from "./booking.js";
import {
  formatSpokenDate,
  formatSpokenTime,
  getCurrentDateTime,
} from "../helper.js";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_ACCOUNT_TOKEN;

const TwClient = twilio(accountSid, authToken);
const client = new Cerebras({
  apiKey: process.env.CEREBRAS_API_KEY, // This is the default and can be omitted
});
const { date, time } = getCurrentDateTime();

// Simple in-memory conversation store
let conversation: { role: "system" | "user" | "assistant"; content: string }[] =
  [
    {
      role: "system",
      content: `
You are a warm and professional dental clinic receptionist.
Your responsibilities:
- Don't give intro
- Greet patients kindly and sound caring.
- Help with booking, rescheduling, or canceling appointments.
- Always confirm details: patient name, contact, date, and time.
- Keep responses short and simple for text-to-speech (avoid numbers, write them out as words).
- Provide basic comfort tips only (like rinsing with warm water, using ice packs).
- If question is too medical, suggest speaking with the dentist.
- When you have enough details, reply ONLY with JSON tool_call.
- When the conversation ends, reply ONLY with { "tool": "hangup" }.


Date format for tools: use YYYY-MM-DD (e.g., "2025-10-02")
Time format for tools: use HH:MM in 24-hour format (e.g., "15:00" for 3 PM)
The Current Date is -> ${date} and time is ${time}

Examples:
{
  "tool": "book",
  "name": "John Doe",
  "date": "2025-10-02",
  "time": "15:00",
  "spokenDate": "October second",
  "spokenTime": "three PM"
}

{
  "tool": "reschedule",
  "newDate": "2025-10-05",
  "newTime": "14:00",
  "spokenDate": "October fifth",
  "spokenTime": "two PM"
}

Available tools:
- "book": needs name, date, time, spokenDate, spokenTime
- "reschedule": needs  newDate, newTime, spokenDate, spokenTime
- "cancel": no details
- "hangup": no details

Your goal: sound caring, clear, and efficient.
    `,
    },
  ];
// Function that keeps memory
export async function textYield(msg: string): Promise<[string, boolean]> {
  console.log("User said:", msg);

  // Push user message into memory
  conversation.push({ role: "user", content: msg });

  try {
    // Get AI response (replace with your LLM)
    const response = await client.chat.completions.create({
      messages: conversation as any,
      model: "llama-4-scout-17b-16e-instruct",
      stream: false,
      max_tokens: 200,
      temperature: 0.7,
    });

    const rawReply = response.choices[0].message.content ?? "";
    console.log("Raw reply:", rawReply);

    // Try to extract JSON from the reply
    const match = rawReply.match(/\{[\s\S]*\}/);
    let toolResult = null;
    let ttsText = rawReply;
    let parsed;

    if (match) {
      try {
        parsed = JSON.parse(match[0]);

        // Handle tool calls
        if (parsed.tool === "book") {
          // Check availability first
          const availability = await checkAvailability(
            parsed.date,
            parsed.time
          );

          if (!availability.available) {
            const conflictMsg = `I'm sorry, but that time slot is already taken. Would you like to try a different time?`;
            conversation.push({ role: "assistant", content: conflictMsg });
            return [conflictMsg, false];
          }

          // Book the appointment
          toolResult = await bookAppointment(
            parsed.name,
            parsed.date,
            parsed.time,

            `Dental appointment for ${parsed.name}`
          );

          if (toolResult.success) {
            const spokenDate =
              parsed.spokenDate || formatSpokenDate(parsed.date);
            const spokenTime =
              parsed.spokenTime || formatSpokenTime(parsed.time);

            const confirmMsg = `Perfect! I've booked your appointment for ${spokenDate} at ${spokenTime}. You'll receive a confirmation email shortly with all the details.`;

            conversation.push({
              role: "assistant",
              content: `Tool executed: ${JSON.stringify(
                toolResult
              )}. Response: ${confirmMsg}`,
            });

            return [confirmMsg, false];
          } else {
            const errorMsg = `I'm sorry, there was an issue booking your appointment. ${toolResult.error}. Would you like to try a different time?`;
            conversation.push({ role: "assistant", content: errorMsg });
            return [errorMsg, false];
          }
        } else if (parsed.tool === "reschedule") {
          // Check new time availability
          const availability = await checkAvailability(
            parsed.newDate,
            parsed.newTime
          );

          if (!availability.available) {
            const conflictMsg = `I'm sorry, but that new time slot is already taken. Would you like to try a different time?`;
            conversation.push({ role: "assistant", content: conflictMsg });
            return [conflictMsg, false];
          }

          toolResult = await rescheduleAppointment(
            parsed.newDate,
            parsed.newTime
          );

          if (toolResult.success) {
            const spokenDate =
              parsed.spokenDate || formatSpokenDate(parsed.newDate);
            const spokenTime =
              parsed.spokenTime || formatSpokenTime(parsed.newTime);

            const confirmMsg = `All set! I've rescheduled your appointment to ${spokenDate} at ${spokenTime}. You'll receive an updated confirmation email.`;

            conversation.push({
              role: "assistant",
              content: `Tool executed: ${JSON.stringify(
                toolResult
              )}. Response: ${confirmMsg}`,
            });

            return [confirmMsg, false];
          } else {
            const errorMsg = `I'm sorry, I couldn't reschedule your appointment. ${toolResult.error}. Could you verify your appointment ID?`;
            conversation.push({ role: "assistant", content: errorMsg });
            return [errorMsg, false];
          }
        } else if (parsed.tool === "cancel") {
          toolResult = await cancelAppointment();

          if (toolResult.success) {
            const confirmMsg = `Your appointment has been cancelled. If you need to book again in the future, just let me know!`;

            conversation.push({
              role: "assistant",
              content: `Tool executed: ${JSON.stringify(
                toolResult
              )}. Response: ${confirmMsg}`,
            });

            return [confirmMsg, false];
          } else {
            const errorMsg = `I'm sorry, I couldn't cancel your appointment. ${toolResult.error}. Could you verify your appointment ID?`;
            conversation.push({ role: "assistant", content: errorMsg });
            return [errorMsg, false];
          }
        } else if (parsed.tool === "hangup") {
          const goodbyeMsg = "Thank you for calling! Have a wonderful day!";
          conversation.push({ role: "assistant", content: goodbyeMsg });
          return [goodbyeMsg, true];
        }

        // Strip JSON from spoken text
        ttsText = rawReply.replace(match[0], "").trim();
      } catch (err) {
        console.error("JSON parse or tool execution failed:", err);
        const errorMsg =
          "I apologize, but I'm having trouble processing that. Could you please repeat?";
        conversation.push({ role: "assistant", content: errorMsg });
        return [errorMsg, false];
      }
    }

    // Normal assistant reply (text for TTS)
    if (ttsText && !toolResult) {
      conversation.push({ role: "assistant", content: ttsText });
      return [ttsText, false];
    }

    // Fallback
    const fallbackMsg =
      "I'm here to help. Could you tell me what you'd like to do today?";
    conversation.push({ role: "assistant", content: fallbackMsg });
    return [fallbackMsg, false];
  } catch (error: any) {
    console.error("Error in textYield:", error);
    const errorMsg =
      "I apologize, but I'm experiencing technical difficulties. Please try again.";
    conversation.push({ role: "assistant", content: errorMsg });
    return [errorMsg, false];
  }
}

export const createCall = async (toNum: string) => {
  try {
    const message = await TwClient.calls.create({
      url: "https://cbc1cea37a84.ngrok-free.app/voice",
      to: "+916280823503",
      from: "+18644798961",
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
  streamSid: number,
  isEndCallMsg = false
): Promise<void> => {
  const audioStream = await elevenlabs.textToSpeech.stream(
    "21m00Tcm4TlvDq8ikWAM",
    {
      modelId: "eleven_turbo_v2_5",
      text,
      outputFormat: "ulaw_8000",
      // Optional voice settings that allow you to customize the outpu
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
  if (isEndCallMsg) {
    await twilioWs.send(
      JSON.stringify({
        streamSid,
        event: "mark",
        mark: {
          name: "end call",
        },
      })
    );
  }
};
