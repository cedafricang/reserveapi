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
        <p style="font-size:14px;color:rgba(245,240,232,0.55);line-height:1.7;margin-bottom:32px;">
          One step left. Verify your email address to activate your Reserve account and start earning points.
        </p>
        <a href="${verifyUrl}" style="display:inline-block;background:#C5855A;color:#0E0C0A;text-decoration:none;padding:14px 32px;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:600;border-radius:2px;">
          Verify email address →
        </a>
        <p style="font-size:11px;color:rgba(245,240,232,0.2);margin-top:32px;line-height:1.6;">
          This link expires in 24 hours. If you did not create an account, ignore this email.
        </p>
        <div style="height:1px;background:rgba(197,133,90,0.1);margin:32px 0;"></div>
        <p style="font-size:11px;color:rgba(245,240,232,0.18);">
          17 Adeyemo Alakija Street · Victoria Island · Lagos · reserve.soundhous.com
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
        <p style="font-size:14px;color:rgba(245,240,232,0.55);line-height:1.7;margin-bottom:32px;">
          We received a request to reset your password. Click below to set a new one.
        </p>
        <a href="${resetUrl}" style="display:inline-block;background:#C5855A;color:#0E0C0A;text-decoration:none;padding:14px 32px;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:600;border-radius:2px;">
          Reset password →
        </a>
        <p style="font-size:11px;color:rgba(245,240,232,0.2);margin-top:32px;line-height:1.6;">
          This link expires in 1 hour. If you did not request a reset, ignore this email.
        </p>
        <div style="height:1px;background:rgba(197,133,90,0.1);margin:32px 0;"></div>
        <p style="font-size:11px;color:rgba(245,240,232,0.18);">
          17 Adeyemo Alakija Street · Victoria Island · Lagos · reserve.soundhous.com
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
        <p style="font-size:14px;color:rgba(245,240,232,0.55);line-height:1.7;margin-bottom:24px;">
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
        <p style="font-size:11px;color:rgba(245,240,232,0.18);">
          17 Adeyemo Alakija Street · Victoria Island · Lagos · reserve.soundhous.com
        </p>
      </div>
    `,
  })
}