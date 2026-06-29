import { Request, Response } from 'express'
import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import { query } from '../db'

// ── Verify GoAffPro webhook signature ────────────────────────
const verifyGoAffProWebhook = (
  rawBody: Buffer,
  signatureHeader: string
): boolean => {
  const secret = process.env.GOAFFPRO_WEBHOOK_SECRET!
  if (!secret) {
    console.warn('GOAFFPRO_WEBHOOK_SECRET not set — skipping verification in dev')
    return true
  }
  const hash = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')
  try {
    return crypto.timingSafeEqual(
      Buffer.from(hash),
      Buffer.from(signatureHeader)
    )
  } catch {
    return false
  }
}

// ── REFERRAL CONVERTED ────────────────────────────────────────
// Fires when someone buys on soundhous.com through an affiliate link
export const handleReferralConverted = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    // Verify signature
    const signatureHeader = req.headers['x-goaffpro-signature'] as string
    const rawBody = (req as Request & { rawBody: Buffer }).rawBody

    if (signatureHeader && rawBody) {
      const isValid = verifyGoAffProWebhook(rawBody, signatureHeader)
      if (!isValid) {
        console.warn('Invalid GoAffPro webhook signature')
        res.status(401).json({ success: false, message: 'Invalid signature.' })
        return
      }
    }

    const payload = req.body

    // GoAffPro sends affiliate details in different formats
    // depending on the plan — handle both
    const affiliateEmail =
      payload.affiliate?.email ||
      payload.partner?.email ||
      payload.referrer?.email ||
      null

    const orderId =
      payload.order?.id ||
      payload.order_id ||
      payload.id ||
      null

    const orderValue =
      payload.order?.total ||
      payload.order_total ||
      payload.sale_amount ||
      0

    if (!affiliateEmail) {
      console.log('GoAffPro webhook missing affiliate email — skipping')
      res.status(200).json({ received: true })
      return
    }

    const emailLower = affiliateEmail.toLowerCase().trim()

    // Idempotency check — have we processed this referral before
   // Idempotency check using a dedicated column approach
// Check if this exact order ID has been processed
if (orderId) {
  const alreadyProcessed = await query(
    `SELECT id FROM points_transactions
     WHERE customer_id = (SELECT id FROM customers WHERE email = $1)
     AND description ILIKE $2
     AND type = 'earn-referral-product'
     LIMIT 1`,
    [emailLower, `%${orderId}%`]
  )

  if (alreadyProcessed.rows.length > 0) {
    console.log('GoAffPro referral already processed — skipping:', orderId)
    res.status(200).json({ received: true })
    return
  }
}

    

    const REFERRAL_POINTS = 50

    // Find the affiliate's Reserve account
    const customerResult = await query(
      'SELECT id, points_balance, tier FROM customers WHERE email = $1',
      [emailLower]
    )

    if (customerResult.rows.length === 0) {
      // Affiliate does not have a Reserve account yet
      // Store as pending — will be applied when they sign up
      const alreadyPending = await query(
        `SELECT id FROM pending_referral_points
         WHERE affiliate_email = $1 AND applied = false
         LIMIT 1`,
        [emailLower]
      )

      if (alreadyPending.rows.length === 0) {
        await query(
          `INSERT INTO pending_referral_points
             (id, affiliate_email, points, source, applied, created_at)
           VALUES ($1, $2, $3, 'goaffpro', false, NOW())`,
          [uuidv4(), emailLower, REFERRAL_POINTS]
        )
        console.log(`Pending referral points stored for: ${emailLower}`)
      }

      res.status(200).json({
        received: true,
        status: 'pending',
        message: 'Affiliate does not have a Reserve account yet. Points stored as pending.',
      })
      return
    }

    const customer = customerResult.rows[0]

    // Award 50 points to the affiliate
    await query(
      `UPDATE customers
       SET points_balance = points_balance + $1,
           last_active_at = NOW(),
           updated_at = NOW()
       WHERE id = $2`,
      [REFERRAL_POINTS, customer.id]
    )

    // Log the transaction
    await query(
      `INSERT INTO points_transactions
         (id, customer_id, type, points, description, created_at)
       VALUES ($1, $2, 'earn-referral-product', $3, $4, NOW())`,
      [
        uuidv4(),
        customer.id,
        REFERRAL_POINTS,
        `GoAffPro referral — order ${orderId || 'unknown'} — ₦${Number(orderValue).toLocaleString()}`,
      ]
    )

    console.log(
      `GoAffPro referral processed: ${emailLower} earned ${REFERRAL_POINTS} points — order ${orderId}`
    )

    res.status(200).json({
      received: true,
      status: 'awarded',
      pointsAwarded: REFERRAL_POINTS,
      affiliateEmail: emailLower,
    })
  } catch (err) {
    console.error('GoAffPro referral webhook error:', err)
    res.status(200).json({ received: true })
  }
}

// ── COMMISSION APPROVED ───────────────────────────────────────
// Some GoAffPro plans use this event instead of referral_converted
// We handle both pointing to the same logic
export const handleCommissionApproved = handleReferralConverted