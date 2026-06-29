import { Request, Response } from 'express'
import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import { query } from '../db'
import { awardPoints, checkAndUpgradeTier } from './customer.controller'

// ── Verify Shopify webhook signature ─────────────────────────
const verifyShopifyWebhook = (
  rawBody: Buffer,
  hmacHeader: string
): boolean => {
  const secret = process.env.SHOPIFY_CLIENT_SECRET!
  const hash = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64')
  return crypto.timingSafeEqual(
    Buffer.from(hash),
    Buffer.from(hmacHeader)
  )
}

// ── ORDER PAID ────────────────────────────────────────────────
// Fires when a customer completes a purchase on soundhous.com
export const handleOrderPaid = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    // Verify the webhook is genuinely from Shopify
    const hmacHeader = req.headers['x-shopify-hmac-sha256'] as string
    if (!hmacHeader) {
      res.status(401).json({ success: false, message: 'Missing HMAC header.' })
      return
    }

    const rawBody = (req as Request & { rawBody: Buffer }).rawBody
    if (!rawBody) {
      res.status(400).json({ success: false, message: 'Raw body not available.' })
      return
    }

    const isValid = verifyShopifyWebhook(rawBody, hmacHeader)
    if (!isValid) {
      console.warn('Invalid Shopify webhook signature received')
      res.status(401).json({ success: false, message: 'Invalid webhook signature.' })
      return
    }

    const order = req.body

    // Extract what we need from the Shopify order payload
    const shopifyOrderId = String(order.id)
    const customerEmail = order.email?.toLowerCase()?.trim()
    const shopifyCustomerId = order.customer?.id ? String(order.customer.id) : null
    const firstName = order.customer?.first_name || ''
    const lastName = order.customer?.last_name || ''
    const orderTotal = Math.round(parseFloat(order.total_price || '0') * 100) // convert to kobo equivalent (store in naira kobo for precision)
    const orderTotalNaira = parseFloat(order.total_price || '0')

    if (!customerEmail) {
      console.log('Shopify order has no email — skipping:', shopifyOrderId)
      res.status(200).json({ received: true })
      return
    }

    // Idempotency check — have we already processed this order?
    const alreadyProcessed = await query(
      `SELECT id FROM points_transactions
       WHERE description ILIKE $1
       LIMIT 1`,
      [`%Shopify order ${shopifyOrderId}%`]
    )

    if (alreadyProcessed.rows.length > 0) {
      console.log('Order already processed — skipping:', shopifyOrderId)
      res.status(200).json({ received: true })
      return
    }

    // Find or create the Reserve customer
    let customer = await query(
      'SELECT * FROM customers WHERE email = $1',
      [customerEmail]
    )

    if (customer.rows.length === 0) {
      // Customer does not have a Reserve account yet — create one automatically
      const newCustomerId = uuidv4()
      const referralCode = generateReferralCode(firstName || customerEmail.split('@')[0])

      await query(
        `INSERT INTO customers (
          id, email, first_name, last_name,
          shopify_customer_id, tier, points_balance, annual_spend,
          complimentary_sessions_used_this_year,
          referral_code, email_verified,
          last_active_at, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4,
          $5, 'reserve-member', 0, 0,
          0,
          $6, true,
          NOW(), NOW(), NOW()
        )`,
        [
          newCustomerId,
          customerEmail,
          firstName,
          lastName,
          shopifyCustomerId,
          referralCode,
        ]
      )

      customer = await query(
        'SELECT * FROM customers WHERE id = $1',
        [newCustomerId]
      )

      console.log(`New Reserve customer created from Shopify: ${customerEmail}`)
    } else {
      // Update Shopify customer ID if not already set
      if (shopifyCustomerId && !customer.rows[0].shopify_customer_id) {
        await query(
          `UPDATE customers
           SET shopify_customer_id = $1, updated_at = NOW()
           WHERE id = $2`,
          [shopifyCustomerId, customer.rows[0].id]
        )
      }
    }

    const customerId = customer.rows[0].id

    // Award points for the purchase
    const pointsEarned = await awardPoints(
      customerId,
      orderTotalNaira,
      `Shopify order ${shopifyOrderId} — ₦${orderTotalNaira.toLocaleString()}`,
      'earn-purchase'
    )

    // Update annual spend
    await query(
      `UPDATE customers
       SET annual_spend = annual_spend + $1,
           last_active_at = NOW(),
           updated_at = NOW()
       WHERE id = $2`,
      [Math.round(orderTotalNaira), customerId]
    )

    // Check tier upgrade
    await checkAndUpgradeTier(customerId)

    // Check for pending referral points from GoAffPro
    const pendingReferral = await query(
      `SELECT * FROM pending_referral_points
       WHERE affiliate_email = $1 AND applied = false
       LIMIT 1`,
      [customerEmail]
    )

    if (pendingReferral.rows.length > 0) {
      const pending = pendingReferral.rows[0]

      await query(
        `UPDATE customers
         SET points_balance = points_balance + $1,
             updated_at = NOW()
         WHERE id = $2`,
        [pending.points, customerId]
      )

      await query(
        `INSERT INTO points_transactions
           (id, customer_id, type, points, description, created_at)
         VALUES ($1, $2, 'earn-referral-product', $3, $4, NOW())`,
        [
          uuidv4(),
          customerId,
          pending.points,
          'GoAffPro referral points applied on account creation',
        ]
      )

      await query(
        `UPDATE pending_referral_points
         SET applied = true, applied_at = NOW()
         WHERE id = $1`,
        [pending.id]
      )

      console.log(`Pending referral points applied: ${pending.points} pts to ${customerEmail}`)
    }

    console.log(`Shopify order processed: ${shopifyOrderId} — ${customerEmail} — ₦${orderTotalNaira} — ${pointsEarned} pts`)

    // Always return 200 to Shopify immediately
    res.status(200).json({ received: true, pointsEarned })
  } catch (err) {
    console.error('Shopify order paid webhook error:', err)
    // Still return 200 to prevent Shopify from retrying
    res.status(200).json({ received: true })
  }
}

// ── CUSTOMER CREATED ──────────────────────────────────────────
// Fires when a new account is created on soundhous.com
export const handleCustomerCreated = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    // Verify signature
    const hmacHeader = req.headers['x-shopify-hmac-sha256'] as string
    const rawBody = (req as Request & { rawBody: Buffer }).rawBody

    if (!hmacHeader || !rawBody) {
      res.status(401).json({ success: false, message: 'Unauthorized.' })
      return
    }

    const isValid = verifyShopifyWebhook(rawBody, hmacHeader)
    if (!isValid) {
      res.status(401).json({ success: false, message: 'Invalid webhook signature.' })
      return
    }

    const customer = req.body
    const email = customer.email?.toLowerCase()?.trim()
    const shopifyCustomerId = String(customer.id)
    const firstName = customer.first_name || ''
    const lastName = customer.last_name || ''

    if (!email) {
      res.status(200).json({ received: true })
      return
    }

    // Check if Reserve account already exists
    const existing = await query(
      'SELECT id, shopify_customer_id FROM customers WHERE email = $1',
      [email]
    )

    if (existing.rows.length > 0) {
      // Update Shopify ID if not set
      if (!existing.rows[0].shopify_customer_id) {
        await query(
          `UPDATE customers
           SET shopify_customer_id = $1, updated_at = NOW()
           WHERE id = $2`,
          [shopifyCustomerId, existing.rows[0].id]
        )
        console.log(`Shopify ID linked to existing Reserve account: ${email}`)
      }
      res.status(200).json({ received: true })
      return
    }

    // Create new Reserve account
    const newCustomerId = uuidv4()
    const referralCode = generateReferralCode(firstName || email.split('@')[0])

    await query(
      `INSERT INTO customers (
        id, email, first_name, last_name,
        shopify_customer_id, tier, points_balance, annual_spend,
        complimentary_sessions_used_this_year,
        referral_code, email_verified,
        last_active_at, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, 'reserve-member', 0, 0,
        0,
        $6, true,
        NOW(), NOW(), NOW()
      )`,
      [
        newCustomerId,
        email,
        firstName,
        lastName,
        shopifyCustomerId,
        referralCode,
      ]
    )

    console.log(`New Reserve customer created from Shopify account: ${email}`)
    res.status(200).json({ received: true })
  } catch (err) {
    console.error('Shopify customer created webhook error:', err)
    res.status(200).json({ received: true })
  }
}

// ── Helper ────────────────────────────────────────────────────
const generateReferralCode = (name: string): string => {
  const clean = name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6)
  const suffix = Math.floor(1000 + Math.random() * 9000)
  return `${clean}${suffix}`
}