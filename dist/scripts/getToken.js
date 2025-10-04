import { google } from "googleapis";
import * as readline from "readline";
const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
// Scopes for calendar access
const SCOPES = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.events",
];
// Generate auth URL
const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent", // Force to get refresh token
});
console.log("\n🔗 Authorize this app by visiting this URL:\n");
console.log(authUrl);
console.log("\n");
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});
rl.question("📋 Enter the code from that page here: ", async (code) => {
    rl.close();
    try {
        const { tokens } = await oauth2Client.getToken(code);
        console.log("\n✅ Tokens received!");
        console.log("\n📝 Add these to your .env file:\n");
        console.log(`GOOGLE_ACCESS_TOKEN=${tokens.access_token}`);
        console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
        console.log("\n");
    }
    catch (error) {
        console.error("❌ Error getting tokens:", error);
    }
});
