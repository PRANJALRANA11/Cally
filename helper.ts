export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
export function formatSpokenDate(dateStr: string): string {
  const date = new Date(dateStr);
  const options: Intl.DateTimeFormatOptions = {
    month: "long",
    day: "numeric",
    year: "numeric",
  };
  return date.toLocaleDateString("en-US", options);
}

/**
 * Format time for spoken output
 */
export function formatSpokenTime(timeStr: string): string {
  const [hours, minutes] = timeStr.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  const displayMinutes =
    minutes > 0 ? `:${minutes.toString().padStart(2, "0")}` : "";
  return `${displayHours}${displayMinutes} ${period}`;
}

// utils/dateTime.ts
export function getCurrentDateTime() {
  const now = new Date();

  // Format YYYY-MM-DD
  const date = now.toISOString().split("T")[0];

  // Format HH:MM (24-hour)
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const time = `${hours}:${minutes}`;

  return { date, time };
}
