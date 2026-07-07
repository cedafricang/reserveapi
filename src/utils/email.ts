import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = process.env.RESEND_FROM_EMAIL || 'noreply@reserve.soundhous.com'
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'

export const sendVerificationEmail = async (
  email: string,
  firstName: string,
  token: string
): Promise<void> => {
  const verifyUrl = `${FRONTEND_URL}/verify-email?token=${token}`

  await resend.emails.send({
    from: `Soundhous Reserve <${FROM}>`,
    to: email,
    subject: 'Verify your email address.',
    html: `
      <div style="max-width:480px;margin:0 auto;font-family:'DM Sans',sans-serif;background:#0E0C0A;color:#F5F0E8;padding:48px 40px;border-radius:4px;">
        <p style="font-family:Georgia,serif;font-style:italic;font-size:22px;color:#F5F0E8;margin-bottom:8px;">
          soundhous <span style="color:#C5855A;">reserve</span>
        </p>
        <div style="height:1px;background:rgba(197,133,90,0.15);margin:24px 0;"></div>
        <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#C5855A;margin-bottom:16px;font-weight:500;">
          Verify your email
        </p>
        <h1 style="font-family:Georgia,serif;font-style:italic;font-size:28px;font-weight:400;color:#F5F0E8;margin-bottom:16px;line-height:1.2;">
          Welcome, ${firstName}.
        </h1>
        <p style="font-size:14px;color:#F5F0E8;line-height:1.7;margin-bottom:32px;">
          One step left. Verify your email address to activate your Reserve account and start earning points.
        </p>
        <a href="${verifyUrl}" style="display:inline-block;background:#C5855A;color:#0E0C0A;text-decoration:none;padding:14px 32px;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:600;border-radius:2px;">
          Verify email address →
        </a>
        <p style="font-size:11px;color:#F5F0E8;margin-top:32px;line-height:1.6;">
          This link expires in 24 hours. If you did not create an account, ignore this email.
        </p>
        <div style="height:1px;background:rgba(197,133,90,0.1);margin:32px 0;"></div>
        <p style="font-size:11px;color:#F5F0E8;">
          17 Adeyemo Alakija Street · Victoria Island · Lagos · bookings.soundhous.com
        </p>
      </div>
    `,
  })
}

export const sendPasswordResetEmail = async (
  email: string,
  firstName: string,
  token: string
): Promise<void> => {
  const resetUrl = `${FRONTEND_URL}/reset-password?token=${token}`

  await resend.emails.send({
    from: `Soundhous Reserve <${FROM}>`,
    to: email,
    subject: 'Reset your password.',
    html: `
      <div style="max-width:480px;margin:0 auto;font-family:'DM Sans',sans-serif;background:#0E0C0A;color:#F5F0E8;padding:48px 40px;border-radius:4px;">
        <p style="font-family:Georgia,serif;font-style:italic;font-size:22px;color:#F5F0E8;margin-bottom:8px;">
          soundhous <span style="color:#C5855A;">reserve</span>
        </p>
        <div style="height:1px;background:rgba(197,133,90,0.15);margin:24px 0;"></div>
        <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#C5855A;margin-bottom:16px;font-weight:500;">
          Password reset
        </p>
        <h1 style="font-family:Georgia,serif;font-style:italic;font-size:28px;font-weight:400;color:#F5F0E8;margin-bottom:16px;line-height:1.2;">
          Reset your password.
        </h1>
        <p style="font-size:14px;color:#F5F0E8;line-height:1.7;margin-bottom:32px;">
          We received a request to reset your password. Click below to set a new one.
        </p>
        <a href="${resetUrl}" style="display:inline-block;background:#C5855A;color:#0E0C0A;text-decoration:none;padding:14px 32px;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:600;border-radius:2px;">
          Reset password →
        </a>
        <p style="font-size:11px;color:#F5F0E8;margin-top:32px;line-height:1.6;">
          This link expires in 1 hour. If you did not request a reset, ignore this email.
        </p>
        <div style="height:1px;background:rgba(197,133,90,0.1);margin:32px 0;"></div>
        <p style="font-size:11px;color:#F5F0E8;">
          17 Adeyemo Alakija Street · Victoria Island · Lagos · bookings.soundhous.com
        </p>
      </div>
    `,
  })
}

export const sendWelcomeEmail = async (
  email: string,
  firstName: string,
  referralCode: string
): Promise<void> => {
  await resend.emails.send({
    from: `Soundhous Reserve <${FROM}>`,
    to: email,
    subject: 'Your account is ready.',
    html: `
      <div style="max-width:480px;margin:0 auto;font-family:'DM Sans',sans-serif;background:#0E0C0A;color:#F5F0E8;padding:48px 40px;border-radius:4px;">
        <p style="font-family:Georgia,serif;font-style:italic;font-size:22px;color:#F5F0E8;margin-bottom:8px;">
          soundhous <span style="color:#C5855A;">reserve</span>
        </p>
        <div style="height:1px;background:rgba(197,133,90,0.15);margin:24px 0;"></div>
        <h1 style="font-family:Georgia,serif;font-style:italic;font-size:28px;font-weight:400;color:#F5F0E8;margin-bottom:16px;line-height:1.2;">
          The door is open, ${firstName}.
        </h1>
        <p style="font-size:14px;color:#F5F0E8;line-height:1.7;margin-bottom:24px;">
          Your Reserve account is active. Every purchase on Soundhous and every room booking earns you points toward complimentary sessions.
        </p>
        <div style="background:rgba(197,133,90,0.08);border:1px solid rgba(197,133,90,0.2);border-radius:2px;padding:16px 20px;margin-bottom:32px;">
          <p style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#C5855A;margin-bottom:6px;font-weight:500;">Your referral code</p>
          <p style="font-family:monospace;font-size:18px;color:#F5F0E8;letter-spacing:0.08em;">${referralCode}</p>
          <p style="font-size:11px;color:rgba(245,240,232,0.35);margin-top:6px;">Share this with a friend. When they make their first purchase or booking, you earn 50 points.</p>
        </div>
        <a href="${FRONTEND_URL}/book" style="display:inline-block;background:#C5855A;color:#0E0C0A;text-decoration:none;padding:14px 32px;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:600;border-radius:2px;">
          Book your first room →
        </a>
        <div style="height:1px;background:rgba(197,133,90,0.1);margin:32px 0;"></div>
        <p style="font-size:11px;color:#F5F0E8;">
          17 Adeyemo Alakija Street · Victoria Island · Lagos · bookings.soundhous.com
        </p>
      </div>
    `,
  })
}
export const sendGuestRsvpEmail = async (
  guestEmail: string,
  guestName: string,
  hostName: string,
  room: string,
  date: string,
  timeSlot: string,
  rsvpToken: string
): Promise<void> => {
  const roomLabel = roomDisplayNames[room] || room
  const formattedDate = new Date(date).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  const rsvpUrl = `${FRONTEND_URL}/rsvp/${rsvpToken}`

  await resend.emails.send({
    from: `Soundhous Reserve <${FROM}>`,
    to: guestEmail,
    subject: `${hostName} invited you to Soundhous Reserve`,
    html: `
      <div style="max-width:480px;margin:0 auto;font-family:'DM Sans',sans-serif;background:#0E0C0A;color:#F5F0E8;padding:48px 40px;border-radius:4px;">
        <p style="font-family:Georgia,serif;font-style:italic;font-size:22px;color:#F5F0E8;margin-bottom:8px;">
          soundhous <span style="color:#C5855A;">reserve</span>
        </p>
        <div style="height:1px;background:rgba(197,133,90,0.15);margin:24px 0;"></div>
        <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#C5855A;margin-bottom:16px;font-weight:500;">
          You're invited
        </p>
        <h1 style="font-family:Georgia,serif;font-style:italic;font-size:28px;font-weight:400;color:#F5F0E8;margin-bottom:16px;line-height:1.2;">
          ${guestName}, join ${hostName} at Soundhous.
        </h1>
        <p style="font-size:14px;color:#F5F0E8;line-height:1.7;margin-bottom:24px;">
          ${hostName} has booked the <strong style="color:#F5F0E8;">${roomLabel}</strong> and would like you there.
        </p>
        <div style="background:rgba(197,133,90,0.06);border:1px solid rgba(197,133,90,0.2);border-radius:2px;padding:16px 20px;margin-bottom:28px;">
          <p style="font-size:13px;color:rgba(245,240,232,0.7);margin:0 0 4px;"><strong style="color:#F5F0E8;">${formattedDate}</strong></p>
          <p style="font-size:13px;color:rgba(245,240,232,0.7);margin:0;">${timeSlot}</p>
        </div>
        <a href="${rsvpUrl}" style="display:inline-block;background:#C5855A;color:#0E0C0A;text-decoration:none;padding:14px 32px;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:600;border-radius:2px;">
          RSVP →
        </a>
        <p style="font-size:11px;color:rgba(245,240,232,0.25);margin-top:24px;line-height:1.6;">
          You must RSVP to receive your entry ticket. Without a ticket, access to the Experience Centre cannot be guaranteed.
        </p>
        <div style="height:1px;background:rgba(197,133,90,0.1);margin:32px 0;"></div>
        <p style="font-size:11px;color:#F5F0E8;">
          17 Adeyemo Alakija Street · Victoria Island · Lagos · bookings.soundhous.com
        </p>
      </div>
    `,
  })
}
const roomDisplayNames: Record<string, string> = {
  'private-cinema': 'Private Cinema',
  'hi-fi-room': 'Hi-Fi Room',
  'media-room': 'Media Room',
}

export const sendTicketEmail = async (
  recipientEmail: string,
  recipientName: string,
  ticketNumber: string,
  room: string,
  date: string,
  timeSlot: string,
  hostName: string,
  isHost: boolean
): Promise<void> => {
  const roomLabel = roomDisplayNames[room] || room
  const formattedDate = new Date(date).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  await resend.emails.send({
    from: `Soundhous Reserve <${FROM}>`,
    to: recipientEmail,
    subject: isHost
      ? `Your ticket is ready — ${roomLabel}`
      : `You're confirmed — your ticket for ${hostName}'s session`,
    html: `
      <div style="max-width:520px;margin:0 auto;font-family:'DM Sans',sans-serif;background:#0E0C0A;padding:48px 20px;">
        <p style="font-family:Georgia,serif;font-style:italic;font-size:22px;color:#F5F0E8;text-align:center;margin-bottom:8px;">
          soundhous <span style="color:#C5855A;">reserve</span>
        </p>
        <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#C5855A;text-align:center;margin-bottom:32px;font-weight:500;">
          ${isHost ? 'Your session is confirmed' : `You're going, ${recipientName}`}
        </p>

        <!-- Boarding pass card -->
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:#16130D;border-radius:8px;overflow:hidden;border:1px solid rgba(197,133,90,0.25);">
          <tr>
            <td style="padding:28px 28px 20px;border-bottom:1px dashed rgba(197,133,90,0.3);">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <p style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#F5F0E8; margin:0 0 6px;">Soundhous Experience Centre</p>
                    <p style="font-family:Georgia,serif;font-style:italic;font-size:24px;color:#F5F0E8;margin:0;">${roomLabel}</p>
                  </td>
                  <td align="right" valign="top">
                    <span style="font-size:28px;">&#9992;&#65039;</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px;border-bottom:1px dashed rgba(197,133,90,0.3);">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="50%">
                    <p style="font-size:9px;letter-spacing:0.14em;text-transform:uppercase;color:#F5F0E8; margin:0 0 4px;">Date</p>
                    <p style="font-size:13px;color:#F5F0E8;margin:0;">${formattedDate}</p>
                  </td>
                  <td width="50%">
                    <p style="font-size:9px;letter-spacing:0.14em;text-transform:uppercase;color:#F5F0E8; margin:0 0 4px;">Time</p>
                    <p style="font-size:13px;color:#F5F0E8;margin:0;">${timeSlot}</p>
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
                <tr>
                  <td width="50%">
                    <p style="font-size:9px;letter-spacing:0.14em;text-transform:uppercase;color:#F5F0E8; margin:0 0 4px;">Guest</p>
                    <p style="font-size:13px;color:#F5F0E8;margin:0;">${recipientName}</p>
                  </td>
                  <td width="50%">
                    <p style="font-size:9px;letter-spacing:0.14em;text-transform:uppercase;color: #F5F0E8;margin:0 0 4px;">${isHost ? 'Host' : 'Hosted by'}</p>
                    <p style="font-size:13px;color:#F5F0E8;margin:0;">${hostName}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px;background:rgba(197,133,90,0.05);text-align:center;">
              <p style="font-size:9px;letter-spacing:0.16em;text-transform:uppercase;color:#F5F0E8; margin:0 0 8px;">Ticket number</p>
             <p style="font-family:'DM Mono',monospace;font-size:22px;letter-spacing:0.12em;color:#C5855A;margin:0 0 16px;font-weight:600;">${ticketNumber}</p>
             <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${ticketNumber}&bgcolor=ffffff&color=000000&margin=10"
            </td>
          </tr>
        </table>

        <div style="margin-top:28px;padding:18px 20px;border:1px solid rgba(197,133,90,0.15);border-radius:4px;background:rgba(255,255,255,0.015);">
          <p style="font-size:12px;color:#F5F0E8;line-height:1.7;margin:0;">
            <strong style="color:#F5F0E8;">Keep this ticket safe.</strong> You and every guest must present a valid ticket number at the door. Without it, entry to the Experience Centre cannot be guaranteed.
          </p>
        </div>

        <p style="font-size:11px;color:#F5F0E8; text-align:center;margin-top:32px;">
          17 Adeyemo Alakija Street &middot; Victoria Island &middot; Lagos &middot; bookings.soundhous.com
        </p>
      </div>
    `,
  })
}





const INTERNAL_TEAM = [
  'marketing@ced.africa',
  'sadediran@ced.africa',
  'golayinka@soundhous.com',
  'experience@soundhous.com',
]

export const sendInternalBookingAlert = async (
  eventType: 'new-booking' | 'rsvp-accepted' | 'rsvp-declined',
  details: {
    customerName: string
    customerEmail: string
    room: string
    date: string
    timeSlot: string
    paymentType?: string
    ticketNumber?: string
    guestName?: string
    guestEmail?: string
  }
): Promise<void> => {
  const roomLabel = roomDisplayNames[details.room] || details.room

  const subjects: Record<string, string> = {
    'new-booking': `New booking — ${roomLabel} on ${details.date}`,
    'rsvp-accepted': `Guest confirmed — ${details.guestName} for ${roomLabel}`,
    'rsvp-declined': `Guest declined — ${details.guestName} for ${roomLabel}`,
  }

  const bodyMap: Record<string, string> = {
    'new-booking': `
      <h2 style="font-family:Georgia,serif;font-style:italic;font-weight:400;color:#F5F0E8;margin-bottom:20px;">New booking received.</h2>
      <table style="width:100%;border-collapse:collapse;font-family:sans-serif;font-size:13px;">
        ${row('Room', roomLabel)}
        ${row('Date', details.date)}
        ${row('Time', details.timeSlot)}
        ${row('Booker', `${details.customerName} &lt;${details.customerEmail}&gt;`)}
        ${row('Payment type', details.paymentType || '—')}
        ${row('Ticket number', details.ticketNumber || '—')}
      </table>
    `,
    'rsvp-accepted': `
      <h2 style="font-family:Georgia,serif;font-style:italic;font-weight:400;color:#F5F0E8;margin-bottom:20px;">A guest has confirmed their attendance.</h2>
      <table style="width:100%;border-collapse:collapse;font-family:sans-serif;font-size:13px;">
        ${row('Guest', `${details.guestName} &lt;${details.guestEmail}&gt;`)}
        ${row('Room', roomLabel)}
        ${row('Date', details.date)}
        ${row('Time', details.timeSlot)}
        ${row('Hosted by', details.customerName)}
      </table>
    `,
    'rsvp-declined': `
      <h2 style="font-family:Georgia,serif;font-style:italic;font-weight:400;color:#F5F0E8;margin-bottom:20px;">A guest has declined their invitation.</h2>
      <table style="width:100%;border-collapse:collapse;font-family:sans-serif;font-size:13px;">
        ${row('Guest', `${details.guestName} &lt;${details.guestEmail}&gt;`)}
        ${row('Room', roomLabel)}
        ${row('Date', details.date)}
        ${row('Time', details.timeSlot)}
        ${row('Hosted by', details.customerName)}
      </table>
    `,
  }

  await resend.emails.send({
    from: `Soundhous Reserve <${FROM}>`,
    to: INTERNAL_TEAM,
    subject: subjects[eventType],
    html: `
      <div style="max-width:520px;margin:0 auto;font-family:'DM Sans',sans-serif;background:#0E0C0A;padding:40px;border-radius:4px;">
        <p style="font-family:Georgia,serif;font-style:italic;font-size:20px;color:#F5F0E8;margin-bottom:8px;">
          soundhous <span style="color:#C5855A;">reserve</span>
        </p>
        <p style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#F5F0E8; margin-bottom:28px;">Internal notification</p>
        ${bodyMap[eventType]}
        <p style="font-size:11px;color:F5F0E8; margin-top:32px;">
          This is an automated alert from Soundhous Reserve. Do not reply.
        </p>
      </div>
    `,
  })
}

function row(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid rgba(197,133,90,0.1);color:#F5F0E8;width:40%;">${label}</td>
      <td style="padding:10px 0;border-bottom:1px solid rgba(197,133,90,0.1);color:#F5F0E8;">${value}</td>
    </tr>
  `
}
export const sendRescheduleEmail = async (
  recipientEmail: string,
  recipientName: string,
  room: string,
  oldDate: string,
  oldTimeSlot: string,
  newDate: string,
  newTimeSlot: string,
  isHost: boolean
): Promise<void> => {
  const roomLabel = roomDisplayNames[room] || room
  const formatD = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  await resend.emails.send({
    from: `Soundhous Reserve <${FROM}>`,
    to: recipientEmail,
    subject: `Your booking has been rescheduled — ${roomLabel}`,
    html: `
      <div style="max-width:480px;margin:0 auto;font-family:'DM Sans',sans-serif;background:#0E0C0A;color:#F5F0E8;padding:48px 40px;border-radius:4px;">
        <p style="font-family:Georgia,serif;font-style:italic;font-size:22px;color:#F5F0E8;margin-bottom:8px;">
          soundhous <span style="color:#C5855A;">reserve</span>
        </p>
        <div style="height:1px;background:rgba(197,133,90,0.15);margin:24px 0;"></div>
        <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#C5855A;margin-bottom:16px;font-weight:500;">
          Booking rescheduled
        </p>
        <h1 style="font-family:Georgia,serif;font-style:italic;font-size:26px;font-weight:400;color:#F5F0E8;margin-bottom:16px;line-height:1.2;">
          ${isHost ? 'Your session has been moved.' : `${recipientName}, your session has been moved.`}
        </h1>
        <p style="font-size:14px;color:rgba(245,240,232,0.55);line-height:1.7;margin-bottom:24px;">
          The booking for <strong style="color:#F5F0E8;">${roomLabel}</strong> has been rescheduled to a new date and time.
        </p>
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(197,133,90,0.15);border-radius:2px;padding:20px;margin-bottom:24px;">
          <p style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(245,240,232,0.35);margin-bottom:12px;font-weight:500;">Previous date</p>
          <p style="font-size:13px;color:rgba(245,240,232,0.4);margin-bottom:4px;text-decoration:line-through;">${formatD(oldDate)}</p>
          <p style="font-size:13px;color:rgba(245,240,232,0.4);text-decoration:line-through;">${oldTimeSlot}</p>
        </div>
        <div style="background:rgba(197,133,90,0.06);border:1px solid rgba(197,133,90,0.25);border-radius:2px;padding:20px;margin-bottom:28px;">
          <p style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#C5855A;margin-bottom:12px;font-weight:500;">New date</p>
          <p style="font-size:15px;color:#F5F0E8;margin-bottom:4px;font-weight:500;">${formatD(newDate)}</p>
          <p style="font-size:15px;color:#F5F0E8;">${newTimeSlot}</p>
        </div>
        <p style="font-size:12px;color:rgba(245,240,232,0.3);line-height:1.65;">
          Your ticket number remains the same. Please keep it safe — you will need it at the door.
        </p>
        <div style="height:1px;background:rgba(197,133,90,0.1);margin:32px 0;"></div>
        <p style="font-size:11px;color:rgba(245,240,232,0.18);">17 Adeyemo Alakija Street · Victoria Island · Lagos · reserve.soundhous.com</p>
      </div>
    `,
  })
}
export const sendOfflineCustomerWelcome = async (
  recipientEmail: string,
  firstName: string,
  pointsBalance: number,
  notes?: string
): Promise<void> => {
  const signupUrl = `${FRONTEND_URL}/signup`

  await resend.emails.send({
    from: `Soundhous Reserve <${FROM}>`,
    to: recipientEmail,
    subject: `Your Soundhous Reserve account is ready`,
    html: `
      <div style="max-width:480px;margin:0 auto;font-family:'DM Sans',sans-serif;background:#0E0C0A;color:#F5F0E8;padding:48px 40px;border-radius:4px;">
        <p style="font-family:Georgia,serif;font-style:italic;font-size:22px;color:#F5F0E8;margin-bottom:8px;">
          soundhous <span style="color:#C5855A;">reserve</span>
        </p>
        <div style="height:1px;background:rgba(197,133,90,0.15);margin:24px 0;"></div>
        <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#C5855A;margin-bottom:16px;font-weight:500;">
          You're invited
        </p>
        <h1 style="font-family:Georgia,serif;font-style:italic;font-size:28px;font-weight:400;color:#F5F0E8;margin-bottom:16px;line-height:1.2;">
          Welcome, ${firstName}.
        </h1>
        <p style="font-size:14px;color:rgba(245,240,232,0.55);line-height:1.7;margin-bottom:24px;">
          A Soundhous Reserve account has been created for you. Reserve is our private booking platform for the Soundhous Experience Centre — where you can book the Hi-Fi Room, Private Cinema, or Media Room for an immersive listening or viewing session.
        </p>

        ${pointsBalance > 0 ? `
        <div style="background:rgba(197,133,90,0.06);border:1px solid rgba(197,133,90,0.2);border-radius:2px;padding:20px;margin-bottom:24px;text-align:center;">
          <p style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:rgba(245,240,232,0.4);margin-bottom:8px;font-weight:500;">Points waiting for you</p>
          <p style="font-family:Georgia,serif;font-style:italic;font-size:36px;color:#C5855A;margin:0;font-weight:400;">${pointsBalance.toLocaleString()}</p>
          <p style="font-size:12px;color:rgba(245,240,232,0.35);margin-top:6px;">Redeemable for room bookings</p>
        </div>
        ` : ''}

        ${notes ? `
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(197,133,90,0.1);border-radius:2px;padding:16px;margin-bottom:24px;">
          <p style="font-size:12px;color:rgba(245,240,232,0.45);line-height:1.65;margin:0;">${notes}</p>
        </div>
        ` : ''}

        <p style="font-size:14px;color:rgba(245,240,232,0.55);line-height:1.7;margin-bottom:28px;">
          To activate your account and start booking, simply sign up using this email address. Your points and history will be waiting.
        </p>

        <a href="${signupUrl}" style="display:inline-block;background:#C5855A;color:#0E0C0A;text-decoration:none;padding:14px 32px;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;border-radius:2px;margin-bottom:24px;">
          Activate your account →
        </a>

        <div style="margin-top:8px;padding:16px;border:1px solid rgba(197,133,90,0.1);border-radius:2px;background:rgba(255,255,255,0.02);">
          <p style="font-size:12px;color:rgba(245,240,232,0.4);line-height:1.65;margin:0;">
            <strong style="color:#F5F0E8;">How to book:</strong> Sign up → Browse rooms → Select your date and time → Pay securely or redeem your points → Receive your ticket by email.
          </p>
        </div>

        <div style="height:1px;background:rgba(197,133,90,0.1);margin:32px 0;"></div>
        <p style="font-size:11px;color:rgba(245,240,232,0.18);line-height:1.6;">
          17 Adeyemo Alakija Street · Victoria Island · Lagos · reserve.soundhous.com
        </p>
      </div>
    `,
  })
}