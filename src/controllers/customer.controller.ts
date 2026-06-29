import { Response } from 'express'
import { query } from '../db'
import { AuthRequest } from '../middleware/auth'
import { v4 as uuidv4 } from 'uuid'

// ── Tier thresholds ───────────────────────────────────────────
const TIER_THRESHOLDS = {
  'reserve-member': 0,
  'silver': 2000000,
  'gold': 5000000,
  'platinum': 10000000,
}

const TIER_POINTS_RATE: Record<string, number> = {
  'reserve-member': 1,
  'silver': 2,
  'gold': 3,
  'platinum': 5,
}

const COMPLIMENTARY_SESSIONS: Record<string, number> = {
  'reserve-member': 0,
  'silver': 1,
  'gold': 2,
  'platinum': 4,
}

const POINTS_REDEMPTION: Record<string, number> = {
  'private-cinema': 6000,
  'hi-fi-room': 5000,
  'media-room': 5000,
}

const sanitizeCustomer = (c: Record<string, unknown>) => ({
  id: c.id,
  email: c.email,
  firstName: c.first_name,
  lastName: c.last_name,
  phone: c.phone,
  tier: c.tier,
  pointsBalance: Number(c.points_balance),
  annualSpend: Number(c.annual_spend),
  complimentarySessionsUsed: Number(c.complimentary_sessions_used_this_year),
  complimentarySessionsTotal: COMPLIMENTARY_SESSIONS[c.tier as string] || 0,
  complimentarySessionsRemaining: Math.max(
    0,
    (COMPLIMENTARY_SESSIONS[c.tier as string] || 0) -
    Number(c.complimentary_sessions_used_this_year)
  ),
  referralCode: c.referral_code,
  emailVerified: c.email_verified,
  pointsToNextRoom: {
    'hi-fi-room': Math.max(0, POINTS_REDEMPTION['hi-fi-room'] - Number(c.points_balance)),
    'media-room': Math.max(0, POINTS_REDEMPTION['media-room'] - Number(c.points_balance)),
    'private-cinema': Math.max(0, POINTS_REDEMPTION['private-cinema'] - Number(c.points_balance)),
  },
  earnRate: TIER_POINTS_RATE[c.tier as string] || 1,
  lastActiveAt: c.last_active_at,
  createdAt: c.created_at,
})

// ── GET PROFILE ───────────────────────────────────────────────
export const getProfile = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const result = await query(
      'SELECT * FROM customers WHERE id = $1',
      [req.customer?.customerId]
    )

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Customer not found.' })
      return
    }

    res.status(200).json({
      success: true,
      message: 'Profile retrieved.',
      data: { customer: sanitizeCustomer(result.rows[0]) },
    })
  } catch (err) {
    console.error('Get profile error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

// ── UPDATE PROFILE ────────────────────────────────────────────
export const updateProfile = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { firstName, lastName, phone } = req.body
    const customerId = req.customer?.customerId

    if (!firstName && !lastName && !phone) {
      res.status(400).json({
        success: false,
        message: 'At least one field is required to update.',
      })
      return
    }

    const result = await query(
      `UPDATE customers
       SET
         first_name = COALESCE($1, first_name),
         last_name  = COALESCE($2, last_name),
         phone      = COALESCE($3, phone),
         updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [
        firstName?.trim() || null,
        lastName?.trim() || null,
        phone?.trim() || null,
        customerId,
      ]
    )

    res.status(200).json({
      success: true,
      message: 'Profile updated.',
      data: { customer: sanitizeCustomer(result.rows[0]) },
    })
  } catch (err) {
    console.error('Update profile error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

// ── GET POINTS HISTORY ────────────────────────────────────────
export const getPointsHistory = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const customerId = req.customer?.customerId
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(50, parseInt(req.query.limit as string) || 20)
    const offset = (page - 1) * limit

    const [transactions, countResult] = await Promise.all([
      query(
        `SELECT * FROM points_transactions
         WHERE customer_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [customerId, limit, offset]
      ),
      query(
        'SELECT COUNT(*) FROM points_transactions WHERE customer_id = $1',
        [customerId]
      ),
    ])

    const total = parseInt(countResult.rows[0].count)

    res.status(200).json({
      success: true,
      message: 'Points history retrieved.',
      data: {
        transactions: transactions.rows.map(t => ({
          id: t.id,
          type: t.type,
          points: Number(t.points),
          description: t.description,
          createdAt: t.created_at,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    })
  } catch (err) {
    console.error('Get points history error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

// ── GET BOOKING HISTORY ───────────────────────────────────────
export const getBookingHistory = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const customerId = req.customer?.customerId
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(50, parseInt(req.query.limit as string) || 10)
    const offset = (page - 1) * limit

    const [bookings, countResult] = await Promise.all([
      query(
        `SELECT * FROM bookings
         WHERE customer_id = $1
         ORDER BY booking_date DESC, created_at DESC
         LIMIT $2 OFFSET $3`,
        [customerId, limit, offset]
      ),
      query(
        'SELECT COUNT(*) FROM bookings WHERE customer_id = $1',
        [customerId]
      ),
    ])

    const total = parseInt(countResult.rows[0].count)

    res.status(200).json({
      success: true,
      message: 'Booking history retrieved.',
      data: {
        bookings: bookings.rows.map(b => ({
          id: b.id,
          room: b.room,
          bookingDate: b.booking_date,
          timeSlot: b.time_slot,
          guestCount: b.guest_count,
          paymentType: b.payment_type,
          amountPaid: Number(b.amount_paid),
          refreshment: b.refreshment,
          refreshmentAmount: Number(b.refreshment_amount),
          pointsUsed: Number(b.points_used),
          status: b.status,
          rescheduleCount: b.reschedule_count,
          createdAt: b.created_at,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    })
  } catch (err) {
    console.error('Get booking history error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

// ── GET REFERRAL INFO ─────────────────────────────────────────
export const getReferralInfo = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const customerId = req.customer?.customerId

    const [customerResult, referralsResult] = await Promise.all([
      query(
        'SELECT referral_code FROM customers WHERE id = $1',
        [customerId]
      ),
      query(
        `SELECT
           c.first_name,
           c.last_name,
           c.created_at,
           c.email_verified,
           EXISTS (
             SELECT 1 FROM points_transactions pt
             WHERE pt.customer_id = $1
             AND pt.type IN ('earn-referral-reserve', 'earn-referral-product')
             AND pt.description ILIKE '%' || c.first_name || '%'
           ) as points_awarded
         FROM customers c
         WHERE c.referred_by = $1
         ORDER BY c.created_at DESC`,
        [customerId]
      ),
    ])

    if (customerResult.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Customer not found.' })
      return
    }

    const referralCode = customerResult.rows[0].referral_code
    const frontendUrl = process.env.FRONTEND_URL || 'https://bookings.soundhous.com'

    res.status(200).json({
      success: true,
      message: 'Referral info retrieved.',
      data: {
        referralCode,
        referralLink: `${frontendUrl}?ref=${referralCode}`,
        totalReferrals: referralsResult.rows.length,
        pointsEarned: referralsResult.rows.filter(r => r.points_awarded).length * 50,
        referrals: referralsResult.rows.map(r => ({
          name: `${r.first_name} ${r.last_name.charAt(0)}.`,
          joinedAt: r.created_at,
          verified: r.email_verified,
          pointsAwarded: r.points_awarded,
        })),
      },
    })
  } catch (err) {
    console.error('Get referral info error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

// ── CHECK TIER UPGRADE ────────────────────────────────────────
// Called internally after any spend event
export const checkAndUpgradeTier = async (
  customerId: string
): Promise<void> => {
  const result = await query(
    'SELECT tier, annual_spend FROM customers WHERE id = $1',
    [customerId]
  )

  if (result.rows.length === 0) return

  const { tier: currentTier, annual_spend } = result.rows[0]
  const spend = Number(annual_spend)

  let newTier = 'reserve-member'
  if (spend >= TIER_THRESHOLDS['platinum']) newTier = 'platinum'
  else if (spend >= TIER_THRESHOLDS['gold']) newTier = 'gold'
  else if (spend >= TIER_THRESHOLDS['silver']) newTier = 'silver'

  if (newTier !== currentTier) {
    await query(
      `UPDATE customers SET tier = $1, updated_at = NOW() WHERE id = $2`,
      [newTier, customerId]
    )

    await query(
      `INSERT INTO tier_history (id, customer_id, previous_tier, new_tier, reason, created_at)
       VALUES ($1, $2, $3, $4, 'spend-threshold-crossed', NOW())`,
      [uuidv4(), customerId, currentTier, newTier]
    )

    console.log(`Tier upgraded: ${customerId} ${currentTier} → ${newTier}`)
  }
}

// ── AWARD POINTS ──────────────────────────────────────────────
// Called internally after any eligible transaction
export const awardPoints = async (
  customerId: string,
  amountInNaira: number,
  description: string,
  type: string,
  referenceId?: string
): Promise<number> => {
  const customerResult = await query(
    'SELECT tier FROM customers WHERE id = $1',
    [customerId]
  )

  if (customerResult.rows.length === 0) return 0

  const tier = customerResult.rows[0].tier
  const rate = TIER_POINTS_RATE[tier] || 1
  const pointsEarned = Math.floor((amountInNaira / 1000) * rate)

  if (pointsEarned <= 0) return 0

  await query(
    `UPDATE customers
     SET points_balance = points_balance + $1,
         last_active_at = NOW(),
         updated_at = NOW()
     WHERE id = $2`,
    [pointsEarned, customerId]
  )

  await query(
    `INSERT INTO points_transactions
       (id, customer_id, type, points, description, reference_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [uuidv4(), customerId, type, pointsEarned, description, referenceId || null]
  )

  return pointsEarned
}