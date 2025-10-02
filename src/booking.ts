// calendar-service.ts
import { google } from "googleapis";
import { PrismaClient } from "@prisma/client";

// Initialize Prisma Client
const prisma = new PrismaClient();

// Initialize Google Calendar API
const calendar = google.calendar("v3");

// OAuth2 Configuration
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Set credentials
oauth2Client.setCredentials({
  access_token: process.env.GOOGLE_ACCESS_TOKEN,
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

google.options({ auth: oauth2Client });

// Calendar ID
const CALENDAR_ID = process.env.CALENDAR_ID || "primary";

/**
 * Book an appointment on Google Calendar and store in database
 */
export async function bookAppointment(
  name: string,
  date: string,
  time: string,
  email: string,
  description?: string,
  phone?: string
) {
  try {
    // Parse date and time to create ISO datetime
    const startDateTime = new Date(`${date}T${time}:00`);
    const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);

    // Create event object
    const event = {
      summary: `Appointment: ${name}`,
      description: description || `Dental appointment with ${name}`,
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: process.env.TIMEZONE || "America/New_York",
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: process.env.TIMEZONE || "America/New_York",
      },
      attendees: email ? [{ email }] : [],
      reminders: {
        useDefault: false,
        overrides: [
          { method: "email", minutes: 24 * 60 },
          { method: "popup", minutes: 30 },
        ],
      },
    };

    // Insert event into Google Calendar
    const response = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: event,
      sendUpdates: "all",
    });

    // Store in database
    const appointment = await prisma.appointment.create({
      data: {
        name,
        email,
        phone,
        date,
        time,
        eventId: response.data.id!,
        calendarLink: response.data.htmlLink,
        description,
        status: "scheduled",
        
      },
    });

    return {
      success: true,
      id: appointment.id,
      eventId: appointment.eventId,
      details: appointment,
      calendarLink: appointment.calendarLink,
    };
  } catch (error: any) {
    console.error("Error booking appointment:", error);
    return {
      success: false,
      error: error.message || "Failed to book appointment",
    };
  }
}

/**
 * Reschedule an appointment
 */
export async function rescheduleAppointment(
  email: string,
  newDate: string,
  newTime: string
) {
  try {
    // Find appointment in database
    const appointment = await prisma.appointment.findFirst({
      where: { email },
    });

    if (!appointment) {
      return { success: false, error: "Appointment not found" };
    }

    // Parse new date and time
    const startDateTime = new Date(`${newDate}T${newTime}:00`);
    const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);

    // Get existing event from Google Calendar
    const existingEvent = await calendar.events.get({
      calendarId: CALENDAR_ID,
      eventId: appointment.eventId,
    });

    // Update event with new times
    const updatedEvent = {
      ...existingEvent.data,
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: process.env.TIMEZONE || "America/New_York",
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: process.env.TIMEZONE || "America/New_York",
      },
    };

    const response = await calendar.events.update({
      calendarId: CALENDAR_ID,
      eventId: appointment.eventId,
      requestBody: updatedEvent,
      sendUpdates: "all",
    });

    // Update database
    const updatedAppointment = await prisma.appointment.updateMany({
      where: { email },
      data: {
        date: newDate,
        time: newTime,
        calendarLink: response.data.htmlLink,
      },
    });

    return {
      success: true,
      details: updatedAppointment,
      calendarLink: updatedAppointment.calendarLink,
    };
  } catch (error: any) {
    console.error("Error rescheduling appointment:", error);
    return {
      success: false,
      error: error.message || "Failed to reschedule appointment",
    };
  }
}

/**
 * Cancel an appointment
 */
export async function cancelAppointment(email: string) {
  try {
    // Find appointment in database
    const appointment = await prisma.appointment.findFirst({
      where: { email },
    });

    if (!appointment) {
      return { success: false, error: "Appointment not found" };
    }

    // Delete event from Google Calendar
    await calendar.events.delete({
      calendarId: CALENDAR_ID,
      eventId: appointment.eventId,
      sendUpdates: "all",
    });

    // Update status in database (soft delete)
    await prisma.appointment.updateMany({
      where: { email },
      data: { status: "cancelled" },
    });

    return { success: true };
  } catch (error: any) {
    console.error("Error canceling appointment:", error);
    return {
      success: false,
      error: error.message || "Failed to cancel appointment",
    };
  }
}

/**
 * Check availability for a specific date/time
 */
export async function checkAvailability(date: string, time: string) {
  try {
    const startDateTime = new Date(`${date}T${time}:00`);
    const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);

    // Check Google Calendar
    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: startDateTime.toISOString(),
        timeMax: endDateTime.toISOString(),
        items: [{ id: CALENDAR_ID }],
      },
    });

    const busy = response.data.calendars?.[CALENDAR_ID]?.busy || [];
    const isAvailable = busy.length === 0;

    // Also check local database
    const localAppointments = await prisma.appointment.findMany({
      where: {
        date,
        time,
        status: "scheduled",
      },
    });

    const fullyAvailable = isAvailable && localAppointments.length === 0;

    return {
      success: true,
      available: fullyAvailable,
      conflicts: busy,
      localConflicts: localAppointments,
    };
  } catch (error: any) {
    console.error("Error checking availability:", error);
    return {
      success: false,
      error: error.message || "Failed to check availability",
    };
  }
}
