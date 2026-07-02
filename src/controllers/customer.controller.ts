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
    const customerId = req.customer?.customerId

    const result = await query(
      'SELECT * FROM customers WHERE id = $1',
      [customerId]
    )

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Customer not found.' })
      return
    }

    const customer = result.rows[0]

    // Always calculate annual_spend fresh from actual bookings
    const spendResult = await query(
      `SELECT COALESCE(SUM(amount_paid), 0) as real_spend
       FROM bookings
       WHERE customer_id = $1
       AND payment_type = 'cash'
       AND status != 'cancelled'`,
      [customerId]
    )
    const realSpend = Number(spendResult.rows[0].real_spend)

    // Auto-correct stored value if it has drifted
    if (Number(customer.annual_spend) !== realSpend) {
      await query(
        'UPDATE customers SET annual_spend = $1, updated_at = NOW() WHERE id = $2',
        [realSpend, customerId]
      )
      customer.annual_spend = realSpend
    }
    // Recalculate points balance from actual transactions
const pointsResult = await query(
  `SELECT COALESCE(SUM(points), 0) as real_points
   FROM points_transactions
   WHERE customer_id = $1`,
  [customerId]
)
const realPoints = Number(pointsResult.rows[0].real_points)

if (Number(customer.points_balance) !== realPoints) {
  await query(
    'UPDATE customers SET points_balance = $1, updated_at = NOW() WHERE id = $2',
    [realPoints, customerId]
  )
  customer.points_balance = realPoints
}

    res.status(200).json({
      success: true,
      message: 'Profile retrieved.',
      data: { customer: sanitizeCustomer(customer) },
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

    const customerResult = await query(
      'SELECT id, referral_code FROM customers WHERE id = $1',
      [customerId]
    )

    if (customerResult.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Customer not found.' })
      return
    }

    const customer = customerResult.rows[0]
    const referralLink = `${process.env.FRONTEND_URL}?ref=${customer.referral_code}`

    // Count only referred customers who have made at least one confirmed booking
    const referralStats = await query(
      `SELECT 
        COUNT(DISTINCT c.id) as total_referrals,
        COALESCE(SUM(pt.points), 0) as points_earned
       FROM customers c
       LEFT JOIN points_transactions pt 
         ON pt.customer_id = $1 
         AND pt.type = 'earn-referral-reserve'
       WHERE c.referred_by = $1
       AND EXISTS (
         SELECT 1 FROM bookings b 
         WHERE b.customer_id = c.id 
         AND b.status = 'confirmed'
       )`,
      [customerId]
    )

    const stats = referralStats.rows[0]

    res.status(200).json({
      success: true,
      message: 'Referral info retrieved.',
      data: {
        referralCode: customer.referral_code,
        referralLink,
        totalReferrals: parseInt(stats.total_referrals) || 0,
        pointsEarned: parseInt(stats.points_earned) || 0,
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