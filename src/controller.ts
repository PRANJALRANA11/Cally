import Cerebras from "@cerebras/cerebras_cloud_sdk";
import twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_ACCOUNT_TOKEN;

const TwClient = twilio(accountSid, authToken);
const client = new Cerebras({
  apiKey: process.env.CEREBRAS_API_KEY, // This is the default and can be omitted
});

export async function* textYeild(msg: string) {
  const stream = await client.chat.completions.create({
    messages: [{ role: "user", content: msg }],
    model: "llama-4-17B-omni-16E",
    stream: true,
  });

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content;
    if (text) {
      yield text;
    }
  }
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
