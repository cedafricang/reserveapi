import { Request, Response } from 'express'
import { query } from '../db'
import { v4 as uuidv4 } from 'uuid'

// ── GOAFFPRO ORDER CREATED WEBHOOK ────────────────────────────
// Fires when an affiliate's referral results in an order on soundhous.com
export const handleAffiliateOrderCreated = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const payload = req.body
    console.log('GoAffPro webhook received:', JSON.stringify(payload))

    // Acknowledge immediately so GoAffPro doesn't retry
    res.status(200).json({ success: true, message: 'Webhook received.' })

    // Extract affiliate email from payload
    // GoAffPro sends affiliate info in different shapes depending on plan
    const affiliateEmail =
      payload?.affiliate?.email ||
      payload?.affiliate_email ||
      payload?.customer?.email ||
      null

    if (!affiliateEmail) {
      console.log('GoAffPro: no affiliate email in payload, skipping.')
      return
    }

    const orderTotal = Number(payload?.order?.total || payload?.total || 0)
    const orderId = payload?.order?.id || payload?.order_id || payload?.id || 'unknown'

    // Find matching Reserve customer by email
    const customerResult = await query(
      'SELECT id, points_balance, tier FROM customers WHERE email = $1',
      [affiliateEmail.toLowerCase().trim()]
    )

    if (customerResult.rows.length === 0) {
      console.log(`GoAffPro: no Reserve customer found for affiliate email ${affiliateEmail}`)
      return
    }

    const customer = customerResult.rows[0]

    // Check for duplicate — don't award twice for same order
    const duplicate = await query(
      `SELECT id FROM points_transactions 
       WHERE customer_id = $1 
       AND type = 'earn-referral-product' 
       AND description LIKE $2`,
      [customer.id, `%${orderId}%`]
    )

    if (duplicate.rows.length > 0) {
      console.log(`GoAffPro: order ${orderId} already processed, skipping.`)
      return
    }

    // Award 50 points per referral order
    const pointsToAward = 50

    await query(
      `UPDATE customers 
       SET points_balance = points_balance + $1, 
           last_active_at = NOW(),
           updated_at = NOW() 
       WHERE id = $2`,
      [pointsToAward, customer.id]
    )

    await query(
      `INSERT INTO points_transactions (
        id, customer_id, type, points, description, created_at
      ) VALUES ($1, $2, 'earn-referral-product', $3, $4, NOW())`,
      [
        uuidv4(),
        customer.id,
        pointsToAward,
        `Product referral: Soundhous.com order ${orderId}${orderTotal > 0 ? ` · ₦${orderTotal.toLocaleString()}` : ''}`,
      ]
    )

    console.log(`GoAffPro: awarded ${pointsToAward} points to ${affiliateEmail} for order ${orderId}`)
  } catch (err) {
    console.error('GoAffPro webhook error:', err)
  }
}