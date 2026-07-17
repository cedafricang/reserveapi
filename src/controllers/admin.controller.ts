import { Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { query } from '../db'
import { AuthRequest } from '../middleware/auth'
import { checkAndUpgradeTier } from './customer.controller'
import { sendOfflineCustomerWelcome } from '../utils/email'


// ── OVERVIEW / STATS ──────────────────────────────────────────
export const getOverview = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const [
      bookingsThisMonth,
      revenueThisMonth,
      totalMembers,
      pointsRedeemed,
      tierDistribution,
      recentBookings,
    ] = await Promise.all([
      // Bookings this month
      query(
        `SELECT COUNT(*) as count FROM bookings
         WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())
         AND status != 'cancelled'`
      ),
      // Revenue this month
      query(
        `SELECT COALESCE(SUM(amount_paid), 0) as total FROM bookings
         WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())
         AND status != 'cancelled'
         AND payment_type = 'cash'`
      ),
      // Total members
      query('SELECT COUNT(*) as count FROM customers'),
      // Points redeemed this month
      query(
        `SELECT COALESCE(SUM(ABS(points)), 0) as total FROM points_transactions
         WHERE type = 'redeem-booking'
         AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())`
      ),
      // Tier distribution
      query(
        `SELECT tier, COUNT(*) as count
         FROM customers
         GROUP BY tier
         ORDER BY CASE tier
           WHEN 'platinum' THEN 1
           WHEN 'gold' THEN 2
           WHEN 'silver' THEN 3
           ELSE 4
         END`
      ),
      // Recent bookings
      query(
        `SELECT b.*, c.first_name, c.last_name, c.email, c.tier
         FROM bookings b
         LEFT JOIN customers c ON b.customer_id = c.id
         ORDER BY b.created_at DESC
         LIMIT 10`
      ),
    ])

    res.status(200).json({
      success: true,
      message: 'Overview retrieved.',
      data: {
        stats: {
          bookingsThisMonth: Number(bookingsThisMonth.rows[0].count),
          revenueThisMonth: Number(revenueThisMonth.rows[0].total),
          totalMembers: Number(totalMembers.rows[0].count),
          pointsRedeemedThisMonth: Number(pointsRedeemed.rows[0].total),
        },
        tierDistribution: tierDistribution.rows.map(r => ({
          tier: r.tier,
          count: Number(r.count),
        })),
        recentBookings: recentBookings.rows.map(b => ({
          id: b.id,
          customerName: `${b.first_name || ''} ${b.last_name || ''}`.trim() || b.email,
          customerEmail: b.email,
          customerTier: b.tier,
          room: b.room,
          bookingDate: b.booking_date,
          timeSlot: b.time_slot,
          paymentType: b.payment_type,
          amountPaid: Number(b.amount_paid),
          status: b.status,
          createdAt: b.created_at,
        })),
      },
    })
  } catch (err) {
    console.error('Admin overview error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

// ── GET ALL BOOKINGS ──────────────────────────────────────────
export const getAllBookings = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20)
    const offset = (page - 1) * limit
    const room = req.query.room as string
    const status = req.query.status as string
    const paymentType = req.query.paymentType as string
    const date = req.query.date as string

    let whereClause = 'WHERE 1=1'
    const params: unknown[] = []
    let paramCount = 0

    if (room) {
      paramCount++
      whereClause += ` AND b.room = $${paramCount}`
      params.push(room)
    }
    if (status) {
      paramCount++
      whereClause += ` AND b.status = $${paramCount}`
      params.push(status)
    }
    if (paymentType) {
      paramCount++
      whereClause += ` AND b.payment_type = $${paramCount}`
      params.push(paymentType)
    }
    if (date) {
      paramCount++
      whereClause += ` AND b.booking_date = $${paramCount}`
      params.push(date)
    }

    const [bookings, countResult] = await Promise.all([
      query(
        `SELECT b.*, c.first_name, c.last_name, c.email, c.tier
         FROM bookings b
         LEFT JOIN customers c ON b.customer_id = c.id
         ${whereClause}
         ORDER BY b.booking_date DESC, b.time_slot ASC
         LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
        [...params, limit, offset]
      ),
      query(
        `SELECT COUNT(*) FROM bookings b ${whereClause}`,
        params
      ),
    ])

    const total = parseInt(countResult.rows[0].count)

    res.status(200).json({
      success: true,
      message: 'Bookings retrieved.',
      data: {
        bookings: bookings.rows.map(b => ({
          id: b.id,
          customerName: `${b.first_name || ''} ${b.last_name || ''}`.trim() || b.email,
          customerEmail: b.email,
          customerTier: b.tier,
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
          sessionPurpose: b.session_purpose,
          customerPhone: b.phone,
          createdAt: b.created_at,
        })),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    })
  } catch (err) {
    console.error('Admin get bookings error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

// ── CREATE BOOKING (on behalf of customer) ────────────────────
export const adminCreateBooking = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const {
      customerId, room, date, timeSlot,
      guestCount, paymentType, refreshment, notes,
    } = req.body

    if (!room || !date || !timeSlot || !paymentType) {
      res.status(400).json({
        success: false,
        message: 'Room, date, time slot, and payment type are required.',
      })
      return
    }

    // Check availability
    const existing = await query(
      `SELECT id FROM bookings
       WHERE room = $1 AND booking_date = $2 AND time_slot = $3
       AND status != 'cancelled'`,
      [room, date, timeSlot]
    )

    if (existing.rows.length > 0) {
      res.status(409).json({
        success: false,
        message: 'That time slot is already booked.',
      })
      return
    }

    const bookingId = uuidv4()
    const result = await query(
      `INSERT INTO bookings (
        id, customer_id, room, booking_date, time_slot,
        guest_count, payment_type, amount_paid,
        refreshment, refreshment_amount, points_used,
        status, reschedule_count, notes, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, 0,
        $8, 0, 0,
        'confirmed', 0, $9, NOW(), NOW()
      ) RETURNING *`,
      [
        bookingId,
        customerId || null,
        room,
        date,
        timeSlot,
        guestCount || 1,
        paymentType,
        refreshment || 'none',
        notes || null,
      ]
    )

    res.status(201).json({
      success: true,
      message: 'Booking created by admin.',
      data: { booking: result.rows[0] },
    })
  } catch (err) {
    console.error('Admin create booking error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

// ── CANCEL BOOKING ────────────────────────────────────────────
export const adminCancelBooking = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { bookingId } = req.params
    const { reason } = req.body

    const result = await query(
      `UPDATE bookings
       SET status = 'cancelled',
           notes = COALESCE($1, notes),
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [reason || null, bookingId]
    )

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Booking not found.' })
      return
    }

    res.status(200).json({
      success: true,
      message: 'Booking cancelled.',
      data: { booking: result.rows[0] },
    })
  } catch (err) {
    console.error('Admin cancel booking error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

// ── GET ALL CUSTOMERS ─────────────────────────────────────────
export const getAllCustomers = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20)
    const offset = (page - 1) * limit
    const tier = req.query.tier as string
    const search = req.query.search as string

    let whereClause = 'WHERE 1=1'
    const params: unknown[] = []
    let paramCount = 0

    if (tier) {
      paramCount++
      whereClause += ` AND tier = $${paramCount}`
      params.push(tier)
    }
    if (search) {
      paramCount++
      whereClause += ` AND (
        email ILIKE $${paramCount} OR
        first_name ILIKE $${paramCount} OR
        last_name ILIKE $${paramCount}
      )`
      params.push(`%${search}%`)
    }

    const [customers, countResult] = await Promise.all([
      query(
        `SELECT
           id, email, first_name, last_name, phone, tier,
           points_balance, annual_spend,
           complimentary_sessions_used_this_year,
           referral_code, email_verified,
           last_active_at, created_at
         FROM customers
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
        [...params, limit, offset]
      ),
      query(`SELECT COUNT(*) FROM customers ${whereClause}`, params),
    ])

    const total = parseInt(countResult.rows[0].count)

    res.status(200).json({
      success: true,
      message: 'Customers retrieved.',
      data: {
        customers: customers.rows.map(c => ({
          id: c.id,
          email: c.email,
          firstName: c.first_name,
          lastName: c.last_name,
          phone: c.phone,
          tier: c.tier,
          pointsBalance: Number(c.points_balance),
          annualSpend: Number(c.annual_spend),
          complimentarySessionsUsed: Number(c.complimentary_sessions_used_this_year),
          referralCode: c.referral_code,
          emailVerified: c.email_verified,
          lastActiveAt: c.last_active_at,
          createdAt: c.created_at,
        })),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    })
  } catch (err) {
    console.error('Admin get customers error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

// ── GRANT COMPLIMENTARY ACCESS ────────────────────────────────
export const grantComplimentaryAccess = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { customerId } = req.params
    const { room, date, timeSlot, reason } = req.body

    if (!room || !date || !timeSlot || !reason) {
      res.status(400).json({
        success: false,
        message: 'Room, date, time slot, and reason are required.',
      })
      return
    }

    // Check customer exists
    const customerResult = await query(
      'SELECT id, first_name, last_name FROM customers WHERE id = $1',
      [customerId]
    )

    if (customerResult.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Customer not found.' })
      return
    }

    // Check availability
    const existing = await query(
      `SELECT id FROM bookings
       WHERE room = $1 AND booking_date = $2 AND time_slot = $3
       AND status != 'cancelled'`,
      [room, date, timeSlot]
    )

    if (existing.rows.length > 0) {
      res.status(409).json({
        success: false,
        message: 'That time slot is already booked.',
      })
      return
    }

    const bookingId = uuidv4()
    const result = await query(
      `INSERT INTO bookings (
        id, customer_id, room, booking_date, time_slot,
        guest_count, payment_type, amount_paid,
        refreshment, refreshment_amount, points_used,
        status, reschedule_count, notes, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        1, 'admin-grant', 0,
        'none', 0, 0,
        'confirmed', 0, $6, NOW(), NOW()
      ) RETURNING *`,
      [bookingId, customerId, room, date, timeSlot, `Admin grant: ${reason}`]
    )

    res.status(201).json({
      success: true,
      message: `Complimentary access granted to ${customerResult.rows[0].first_name} ${customerResult.rows[0].last_name}.`,
      data: { booking: result.rows[0] },
    })
  } catch (err) {
    console.error('Grant complimentary access error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

// ── OVERRIDE TIER ─────────────────────────────────────────────
export const overrideTier = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { customerId } = req.params
    const { tier, reason } = req.body

    const validTiers = ['reserve-member', 'silver', 'gold', 'platinum']
    if (!validTiers.includes(tier)) {
      res.status(400).json({
        success: false,
        message: 'Invalid tier. Must be reserve-member, silver, gold, or platinum.',
      })
      return
    }

    if (!reason) {
      res.status(400).json({
        success: false,
        message: 'Reason is required for tier override.',
      })
      return
    }

    const customerResult = await query(
      'SELECT id, tier FROM customers WHERE id = $1',
      [customerId]
    )

    if (customerResult.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Customer not found.' })
      return
    }

    const previousTier = customerResult.rows[0].tier

    await query(
      `UPDATE customers SET tier = $1, updated_at = NOW() WHERE id = $2`,
      [tier, customerId]
    )

    await query(
      `INSERT INTO tier_history
         (id, customer_id, previous_tier, new_tier, reason, created_at)
       VALUES ($1, $2, $3, $4, 'admin-override', NOW())`,
      [uuidv4(), customerId, previousTier, tier]
    )

    res.status(200).json({
      success: true,
      message: `Tier updated from ${previousTier} to ${tier}.`,
      data: { previousTier, newTier: tier, reason },
    })
  } catch (err) {
    console.error('Override tier error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

// ── ADJUST POINTS ─────────────────────────────────────────────
export const adjustPoints = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { customerId } = req.params
    const { points, reason } = req.body

    if (points === undefined || points === null) {
      res.status(400).json({
        success: false,
        message: 'Points amount is required. Use positive to add, negative to deduct.',
      })
      return
    }

    if (!reason) {
      res.status(400).json({
        success: false,
        message: 'Reason is required for points adjustment.',
      })
      return
    }

    const customerResult = await query(
      'SELECT id, points_balance FROM customers WHERE id = $1',
      [customerId]
    )

    if (customerResult.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Customer not found.' })
      return
    }

    const currentBalance = Number(customerResult.rows[0].points_balance)
    const adjustment = Number(points)
    const newBalance = currentBalance + adjustment

    if (newBalance < 0) {
      res.status(400).json({
        success: false,
        message: `Cannot deduct ${Math.abs(adjustment)} points. Customer only has ${currentBalance} points.`,
      })
      return
    }

    await query(
      `UPDATE customers
       SET points_balance = points_balance + $1,
           updated_at = NOW()
       WHERE id = $2`,
      [adjustment, customerId]
    )

    await query(
      `INSERT INTO points_transactions
         (id, customer_id, type, points, description, created_at)
       VALUES ($1, $2, 'admin-adjust', $3, $4, NOW())`,
      [uuidv4(), customerId, adjustment, `Admin adjustment: ${reason}`]
    )

    res.status(200).json({
      success: true,
      message: `Points adjusted by ${adjustment > 0 ? '+' : ''}${adjustment}.`,
      data: {
        previousBalance: currentBalance,
        adjustment,
        newBalance,
        reason,
      },
    })
  } catch (err) {
    console.error('Adjust points error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

// ── GET CLUB MEMBERS ──────────────────────────────────────────
// ── CLUBS ─────────────────────────────────────────────────────

export const createClub = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, description } = req.body
    if (!name?.trim()) {
      res.status(400).json({ success: false, message: 'Club name is required.' })
      return
    }
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const existing = await query('SELECT id FROM clubs WHERE slug = $1', [slug])
    if (existing.rows.length > 0) {
      res.status(409).json({ success: false, message: 'A club with this name already exists.' })
      return
    }
    const result = await query(
      `INSERT INTO clubs (id, name, description, slug, active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, true, NOW(), NOW()) RETURNING *`,
      [uuidv4(), name.trim(), description?.trim() || null, slug]
    )
    res.status(201).json({ success: true, message: 'Club created.', data: { club: result.rows[0] } })
  } catch (err) {
    console.error('Create club error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

export const getAllClubs = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await query(
      `SELECT c.*,
        COUNT(cm.id) as total_ids,
        COUNT(cm.id) FILTER (WHERE cm.claimed = true) as claimed_count
       FROM clubs c
       LEFT JOIN club_membership_ids cm ON c.id = cm.club_id
       GROUP BY c.id
       ORDER BY c.created_at DESC`
    )
    res.status(200).json({ success: true, data: { clubs: result.rows } })
  } catch (err) {
    console.error('Get clubs error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

export const addMembershipIds = async (req: Request, res: Response): Promise<void> => {
  try {
    const { clubId } = req.params
    const { codes } = req.body // array of strings

    if (!Array.isArray(codes) || codes.length === 0) {
      res.status(400).json({ success: false, message: 'At least one membership code is required.' })
      return
    }

    const club = await query('SELECT id FROM clubs WHERE id = $1', [clubId])
    if (club.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Club not found.' })
      return
    }

    const inserted: string[] = []
    const duplicates: string[] = []

    for (const code of codes) {
      const clean = code.trim().toUpperCase()
      if (!clean) continue
      try {
        await query(
          `INSERT INTO club_membership_ids (id, club_id, membership_code, claimed, created_at)
           VALUES ($1, $2, $3, false, NOW())`,
          [uuidv4(), clubId, clean]
        )
        inserted.push(clean)
      } catch {
        duplicates.push(clean)
      }
    }

    res.status(201).json({
      success: true,
      message: `${inserted.length} code(s) added.${duplicates.length > 0 ? ` ${duplicates.length} duplicate(s) skipped.` : ''}`,
      data: { inserted, duplicates },
    })
  } catch (err) {
    console.error('Add membership IDs error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

export const getMembershipIds = async (req: Request, res: Response): Promise<void> => {
  try {
    const { clubId } = req.params
    const result = await query(
      `SELECT cm.*, c.first_name, c.last_name, c.email as customer_email
       FROM club_membership_ids cm
       LEFT JOIN customers c ON cm.claimed_by_customer_id = c.id
       WHERE cm.club_id = $1
       ORDER BY cm.created_at DESC`,
      [clubId]
    )
    res.status(200).json({
      success: true,
      data: {
        ids: result.rows.map(r => ({
          id: r.id,
          code: r.membership_code,
          claimed: r.claimed,
          claimedAt: r.claimed_at,
          claimedBy: r.claimed ? {
            name: `${r.first_name || ''} ${r.last_name || ''}`.trim() || r.customer_email,
            email: r.customer_email,
          } : null,
        })),
        total: result.rows.length,
        claimed: result.rows.filter(r => r.claimed).length,
        unclaimed: result.rows.filter(r => !r.claimed).length,
      },
    })
  } catch (err) {
    console.error('Get membership IDs error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

export const exportMembershipIds = async (req: Request, res: Response): Promise<void> => {
  try {
    const { clubId } = req.params
    const club = await query('SELECT name FROM clubs WHERE id = $1', [clubId])
    if (club.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Club not found.' })
      return
    }

    const result = await query(
      `SELECT cm.membership_code, cm.claimed, cm.claimed_at,
        c.first_name, c.last_name, c.email
       FROM club_membership_ids cm
       LEFT JOIN customers c ON cm.claimed_by_customer_id = c.id
       WHERE cm.club_id = $1
       ORDER BY cm.claimed DESC, cm.created_at ASC`,
      [clubId]
    )

    const headers = ['Membership Code', 'Status', 'Claimed By', 'Email', 'Claimed At']
    const rows = result.rows.map(r => [
      r.membership_code,
      r.claimed ? 'Claimed' : 'Unclaimed',
      r.claimed ? `${r.first_name || ''} ${r.last_name || ''}`.trim() : '',
      r.email || '',
      r.claimed_at ? new Date(r.claimed_at).toLocaleDateString('en-GB') : '',
    ])

    const csv = [headers, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="${club.rows[0].name}-membership-ids-${Date.now()}.csv"`)
    res.send(csv)
  } catch (err) {
    console.error('Export membership IDs error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}
// ── REPORTS ───────────────────────────────────────────────────
export const getReports = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const period = (req.query.period as string) || 'month'

    let dateFilter = `DATE_TRUNC('month', NOW())`
    if (period === 'year') dateFilter = `DATE_TRUNC('year', NOW())`
    if (period === 'week') dateFilter = `DATE_TRUNC('week', NOW())`

    const [
      bookingsByRoom,
      bookingsByType,
      pointsReport,
      revenueByRoom,
      topCustomers,
    ] = await Promise.all([
      // Bookings by room
      query(
        `SELECT room, COUNT(*) as bookings,
           COALESCE(SUM(amount_paid), 0) as revenue
         FROM bookings
         WHERE DATE_TRUNC('${period}', created_at) = ${dateFilter}
         AND status != 'cancelled'
         GROUP BY room`
      ),
      // Bookings by payment type
      query(
        `SELECT payment_type, COUNT(*) as count
         FROM bookings
         WHERE DATE_TRUNC('${period}', created_at) = ${dateFilter}
         AND status != 'cancelled'
         GROUP BY payment_type`
      ),
      // Points report
      query(
        `SELECT
           COALESCE(SUM(CASE WHEN points > 0 THEN points ELSE 0 END), 0) as issued,
           COALESCE(SUM(CASE WHEN points < 0 THEN ABS(points) ELSE 0 END), 0) as redeemed
         FROM points_transactions
         WHERE DATE_TRUNC('${period}', created_at) = ${dateFilter}`
      ),
      // Revenue by room
      query(
        `SELECT room,
           COALESCE(SUM(amount_paid), 0) as total_revenue,
           COUNT(*) as total_bookings
         FROM bookings
         WHERE DATE_TRUNC('${period}', created_at) = ${dateFilter}
         AND payment_type = 'cash'
         AND status != 'cancelled'
         GROUP BY room`
      ),
      // Top customers by spend
      query(
        `SELECT
           c.first_name, c.last_name, c.email, c.tier,
           c.annual_spend, c.points_balance,
           COUNT(b.id) as total_bookings
         FROM customers c
         LEFT JOIN bookings b ON b.customer_id = c.id AND b.status != 'cancelled'
         GROUP BY c.id
         ORDER BY c.annual_spend DESC
         LIMIT 10`
      ),
    ])

    res.status(200).json({
      success: true,
      message: 'Reports retrieved.',
      data: {
        period,
        bookingsByRoom: bookingsByRoom.rows.map(r => ({
          room: r.room,
          bookings: Number(r.bookings),
          revenue: Number(r.revenue),
        })),
        bookingsByType: bookingsByType.rows.map(r => ({
          paymentType: r.payment_type,
          count: Number(r.count),
        })),
        points: {
          issued: Number(pointsReport.rows[0]?.issued || 0),
          redeemed: Number(pointsReport.rows[0]?.redeemed || 0),
        },
        revenueByRoom: revenueByRoom.rows.map(r => ({
          room: r.room,
          totalRevenue: Number(r.total_revenue),
          totalBookings: Number(r.total_bookings),
        })),
        topCustomers: topCustomers.rows.map(c => ({
          name: `${c.first_name} ${c.last_name}`,
          email: c.email,
          tier: c.tier,
          annualSpend: Number(c.annual_spend),
          pointsBalance: Number(c.points_balance),
          totalBookings: Number(c.total_bookings),
        })),
      },
    })
  } catch (err) {
    console.error('Reports error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

// ── ANNUAL RESET (run on 1 January) ──────────────────────────
export const runAnnualReset = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    // Get all customers before reset
    const customers = await query(
      'SELECT id, tier, annual_spend FROM customers'
    )

    let upgraded = 0
    let downgraded = 0
    let unchanged = 0

    for (const customer of customers.rows) {
      const spend = Number(customer.annual_spend)
      const currentTier = customer.tier

      let newTier = 'reserve-member'
      if (spend >= 10000000) newTier = 'platinum'
      else if (spend >= 5000000) newTier = 'gold'
      else if (spend >= 2000000) newTier = 'silver'

      if (newTier !== currentTier) {
        await query(
          `UPDATE customers SET tier = $1, updated_at = NOW() WHERE id = $2`,
          [newTier, customer.id]
        )
        await query(
          `INSERT INTO tier_history
             (id, customer_id, previous_tier, new_tier, reason, created_at)
           VALUES ($1, $2, $3, $4, 'annual-reset', NOW())`,
          [uuidv4(), customer.id, currentTier, newTier]
        )
        if (newTier > currentTier) upgraded++
        else downgraded++
      } else {
        unchanged++
      }
    }

    // Reset annual spend and complimentary sessions
    await query(
      `UPDATE customers
       SET annual_spend = 0,
           complimentary_sessions_used_this_year = 0,
           updated_at = NOW()`
    )

    res.status(200).json({
      success: true,
      message: 'Annual reset completed.',
      data: {
        customersProcessed: customers.rows.length,
        tiersChanged: upgraded + downgraded,
        annualSpendReset: true,
        complimentarySessionsReset: true,
      },
    })
  } catch (err) {
    console.error('Annual reset error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}
// ── CREATE OFFLINE CUSTOMER ───────────────────────────────────
export const createOfflineCustomer = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { firstName, lastName, email, phone, pointsToCredit, notes } = req.body

    if (!firstName || !lastName || !email) {
      res.status(400).json({ success: false, message: 'First name, last name, and email are required.' })
      return
    }

    const emailLower = email.toLowerCase().trim()

    // Check if customer already exists
    const existing = await query('SELECT id, points_balance FROM customers WHERE email = $1', [emailLower])

    if (existing.rows.length > 0) {
      // Customer exists — just credit the points if any
      const customerId = existing.rows[0].id
      const points = Number(pointsToCredit) || 0

      if (points > 0) {
        await query(
          `UPDATE customers SET points_balance = points_balance + $1, updated_at = NOW() WHERE id = $2`,
          [points, customerId]
        )
        await query(
          `INSERT INTO points_transactions (id, customer_id, type, points, description, created_at)
           VALUES ($1, $2, 'admin-adjust', $3, $4, NOW())`,
          [uuidv4(), customerId, points, notes || 'Offline purchase credit']
        )
      }

      const updated = await query('SELECT * FROM customers WHERE id = $1', [customerId])
      // Notify existing customer that points were added
      if (points > 0) {
        const existingName = existing.rows[0].first_name || firstName.trim()
        await sendOfflineCustomerWelcome(
          emailLower,
          existingName,
          points,
          notes || `${points} points have been added to your Reserve account.`
        )
      }
      res.status(200).json({
        success: true,
        message: `Existing account found. ${points > 0 ? `${points} points credited.` : 'No points added.'}`,
        data: { customer: updated.rows[0], pointsCredited: points, wasExisting: true },
      })
      return
    }

    // New offline customer — create with no password (same as Shopify pattern)
    const customerId = uuidv4()
    const referralCode = `${firstName.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5)}${Math.floor(1000 + Math.random() * 9000)}`
    const points = Number(pointsToCredit) || 0

    await query(
      `INSERT INTO customers (
        id, email, first_name, last_name, phone,
        password_hash, tier, points_balance, annual_spend,
        complimentary_sessions_used_this_year,
        referral_code, email_verified,
        last_active_at, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        NULL, 'reserve-member', $6, 0,
        0,
        $7, false,
        NOW(), NOW(), NOW()
      )`,
      [customerId, emailLower, firstName.trim(), lastName.trim(), phone?.trim() || null, points, referralCode]
    )

    if (points > 0) {
      await query(
        `INSERT INTO points_transactions (id, customer_id, type, points, description, created_at)
         VALUES ($1, $2, 'admin-adjust', $3, $4, NOW())`,
        [uuidv4(), customerId, points, notes || 'Offline purchase credit']
      )
    }

    // Send welcome email to new offline customer
    await sendOfflineCustomerWelcome(
      emailLower,
      firstName.trim(),
      points,
      notes
    )

    res.status(201).json({
      success: true,
      message: `Offline customer created.${points > 0 ? ` ${points} points pre-loaded.` : ''} A welcome email has been sent to ${emailLower}.`,
      data: { customerId, email: emailLower, pointsCredited: points, wasExisting: false },
    })

    res.status(201).json({
      success: true,
      message: `Offline customer created.${points > 0 ? ` ${points} points pre-loaded.` : ''} They can sign up at bookings.soundhous.com with this email to activate their account.`,
      data: { customerId, email: emailLower, pointsCredited: points, wasExisting: false },
    })
  } catch (err) {
    console.error('Create offline customer error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

// ── GET ALL BOOKING GUESTS (admin) ────────────────────────────
export const getAdminGuests = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50)
    const offset = parseInt(req.query.offset as string) || 0

    const result = await query(
      `SELECT
         bg.id,
         bg.full_name,
         bg.email,
         bg.rsvp_status,
         bg.ticket_number,
         bg.invited_at,
         bg.responded_at,
         b.room,
         b.booking_date,
         b.time_slot,
         c.first_name || ' ' || c.last_name as host_name,
         c.email as host_email
       FROM booking_guests bg
       JOIN bookings b ON bg.booking_id = b.id
       JOIN customers c ON b.customer_id = c.id
       ORDER BY bg.invited_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    )

    const countResult = await query('SELECT COUNT(*) FROM booking_guests')

    res.status(200).json({
      success: true,
      data: {
        guests: result.rows.map(g => ({
          id: g.id,
          fullName: g.full_name,
          email: g.email,
          rsvpStatus: g.rsvp_status,
          ticketNumber: g.ticket_number,
          invitedAt: g.invited_at,
          respondedAt: g.responded_at,
          room: g.room,
          bookingDate: g.booking_date,
          timeSlot: g.time_slot,
          hostName: g.host_name,
          hostEmail: g.host_email,
        })),
        total: parseInt(countResult.rows[0].count),
      },
    })
  } catch (err) {
    console.error('Get admin guests error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

// ── EXPORT CSV (customers or guests) ─────────────────────────
export const exportCSV = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { type } = req.query // 'customers' | 'guests'

    if (type === 'customers') {
      const result = await query(
        `SELECT email, first_name, last_name, phone, tier, points_balance, annual_spend, email_verified, created_at
         FROM customers ORDER BY created_at DESC`
      )
      const headers = ['Email', 'First Name', 'Last Name', 'Phone', 'Tier', 'Points Balance', 'Annual Spend (₦)', 'Email Verified', 'Joined']
      const rows = result.rows.map(r => [
        r.email, r.first_name, r.last_name, r.phone || '',
        r.tier, r.points_balance, r.annual_spend,
        r.email_verified ? 'Yes' : 'No',
        new Date(r.created_at).toLocaleDateString('en-GB'),
      ])
      const csv = [headers, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
      res.setHeader('Content-Type', 'text/csv')
      res.setHeader('Content-Disposition', `attachment; filename="soundhous-reserve-customers-${Date.now()}.csv"`)
      res.send(csv)
    } else if (type === 'guests') {
      const result = await query(
        `SELECT bg.full_name, bg.email, bg.rsvp_status, bg.ticket_number, bg.invited_at,
                b.room, b.booking_date, b.time_slot,
                c.first_name || ' ' || c.last_name as host_name
         FROM booking_guests bg
         JOIN bookings b ON bg.booking_id = b.id
         JOIN customers c ON b.customer_id = c.id
         ORDER BY bg.invited_at DESC`
      )
      const headers = ['Guest Name', 'Guest Email', 'RSVP Status', 'Ticket Number', 'Invited At', 'Room', 'Booking Date', 'Time Slot', 'Host']
      const rows = result.rows.map(r => [
        r.full_name, r.email, r.rsvp_status, r.ticket_number || '',
        new Date(r.invited_at).toLocaleDateString('en-GB'),
        r.room, new Date(r.booking_date).toLocaleDateString('en-GB'),
        r.time_slot, r.host_name,
      ])
      const csv = [headers, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
      res.setHeader('Content-Type', 'text/csv')
      res.setHeader('Content-Disposition', `attachment; filename="soundhous-reserve-guests-${Date.now()}.csv"`)
      res.send(csv)
    } else {
      res.status(400).json({ success: false, message: 'Invalid export type. Use customers or guests.' })
    }
  } catch (err) {
    console.error('Export CSV error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}
// ── GET SINGLE BOOKING DETAIL (admin) ────────────────────────
export const getBookingDetail = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { bookingId } = req.params

    const bookingResult = await query(
      `SELECT b.*, 
        c.first_name, c.last_name, c.email as customer_email, c.tier, c.phone,
        c.points_balance, c.annual_spend
       FROM bookings b
       LEFT JOIN customers c ON b.customer_id = c.id
       WHERE b.id = $1`,
      [bookingId]
    )

    if (bookingResult.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Booking not found.' })
      return
    }

    const b = bookingResult.rows[0]

    // Get guests
    const guestsResult = await query(
      `SELECT id, full_name, email, rsvp_status, ticket_number, invited_at, responded_at
       FROM booking_guests WHERE booking_id = $1 ORDER BY invited_at ASC`,
      [bookingId]
    )

    res.status(200).json({
      success: true,
      data: {
        booking: {
          id: b.id,
          room: b.room,
          bookingDate: b.booking_date,
          timeSlot: b.time_slot,
          guestCount: b.guest_count,
          paymentType: b.payment_type,
          amountPaid: Number(b.amount_paid),
          pointsUsed: Number(b.points_used),
          refreshment: b.refreshment,
          refreshmentAmount: Number(b.refreshment_amount),
          status: b.status,
          ticketNumber: b.ticket_number,
          rescheduleCount: b.reschedule_count,
          sessionPurpose: b.session_purpose,
          reschedulesRemaining: Math.max(0, 2 - b.reschedule_count),
          createdAt: b.created_at,
          updatedAt: b.updated_at,
          customer: {
            name: `${b.first_name || ''} ${b.last_name || ''}`.trim() || b.customer_email,
            email: b.customer_email,
            phone: b.phone,
            tier: b.tier,
            pointsBalance: Number(b.points_balance),
            annualSpend: Number(b.annual_spend),
          },
          guests: guestsResult.rows.map(g => ({
            id: g.id,
            fullName: g.full_name,
            email: g.email,
            rsvpStatus: g.rsvp_status,
            ticketNumber: g.ticket_number,
            invitedAt: g.invited_at,
            respondedAt: g.responded_at,
          })),
        },
      },
    })
  } catch (err) {
    console.error('Get booking detail error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}
// ── CHECK IN TICKET ───────────────────────────────────────────
export const checkInTicket = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { ticketNumber } = req.body

    if (!ticketNumber?.trim()) {
      res.status(400).json({ success: false, message: 'Ticket number is required.' })
      return
    }

    const code = ticketNumber.trim().toUpperCase()

    // Check host ticket first
    const hostTicket = await query(
      `SELECT b.*, c.first_name, c.last_name, c.email
       FROM bookings b
       LEFT JOIN customers c ON b.customer_id = c.id
       WHERE b.ticket_number = $1`,
      [code]
    )

    if (hostTicket.rows.length > 0) {
      const booking = hostTicket.rows[0]

      if (booking.checked_in) {
        res.status(409).json({
          success: false,
          message: `This ticket was already checked in at ${new Date(booking.checked_in_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`,
          data: {
            alreadyUsed: true,
            checkedInAt: booking.checked_in_at,
            name: `${booking.first_name} ${booking.last_name}`,
            room: booking.room,
            ticketNumber: code,
          },
        })
        return
      }

      // Mark as checked in
      await query(
        `UPDATE bookings SET checked_in = true, checked_in_at = NOW() WHERE ticket_number = $1`,
        [code]
      )

      res.status(200).json({
        success: true,
        message: 'Check-in successful.',
        data: {
          type: 'host',
          name: `${booking.first_name} ${booking.last_name}`,
          email: booking.email,
          room: booking.room,
          bookingDate: booking.booking_date,
          timeSlot: booking.time_slot,
          ticketNumber: code,
          checkedInAt: new Date().toISOString(),
        },
      })
      return
    }

    // Check guest ticket
    const guestTicket = await query(
      `SELECT bg.*, b.room, b.booking_date, b.time_slot,
        c.first_name as host_first, c.last_name as host_last
       FROM booking_guests bg
       JOIN bookings b ON bg.booking_id = b.id
       JOIN customers c ON b.customer_id = c.id
       WHERE bg.ticket_number = $1`,
      [code]
    )

    if (guestTicket.rows.length > 0) {
      const guest = guestTicket.rows[0]

      if (guest.checked_in) {
        res.status(409).json({
          success: false,
          message: `This ticket was already checked in at ${new Date(guest.checked_in_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`,
          data: {
            alreadyUsed: true,
            checkedInAt: guest.checked_in_at,
            name: guest.full_name,
            room: guest.room,
            ticketNumber: code,
          },
        })
        return
      }

      // Mark guest as checked in
      await query(
        `UPDATE booking_guests SET checked_in = true, checked_in_at = NOW() WHERE ticket_number = $1`,
        [code]
      )

      res.status(200).json({
        success: true,
        message: 'Check-in successful.',
        data: {
          type: 'guest',
          name: guest.full_name,
          email: guest.email,
          room: guest.room,
          bookingDate: guest.booking_date,
          timeSlot: guest.time_slot,
          hostName: `${guest.host_first} ${guest.host_last}`,
          ticketNumber: code,
          checkedInAt: new Date().toISOString(),
        },
      })
      return
    }

    // Not found
    res.status(404).json({
      success: false,
      message: 'Invalid ticket. This ticket number does not exist.',
      data: { notFound: true },
    })
  } catch (err) {
    console.error('Check-in error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

// ── GET ALL TICKETS (admin) ───────────────────────────────────
export const getAllTickets = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const filter = req.query.filter as string // 'all' | 'used' | 'unused'

    let whereClause = ''
    if (filter === 'used') whereClause = 'WHERE b.checked_in = true'
    if (filter === 'unused') whereClause = 'WHERE b.checked_in = false'

    const hostTickets = await query(
      `SELECT 
        b.ticket_number,
        b.room,
        b.booking_date,
        b.time_slot,
        b.checked_in,
        b.checked_in_at,
        b.status,
        c.first_name || ' ' || c.last_name as holder_name,
        c.email as holder_email,
        'host' as ticket_type
       FROM bookings b
       LEFT JOIN customers c ON b.customer_id = c.id
       WHERE b.ticket_number IS NOT NULL
       ${filter === 'used' ? 'AND b.checked_in = true' : filter === 'unused' ? 'AND b.checked_in = false' : ''}
       ORDER BY b.booking_date DESC`
    )

    const guestTickets = await query(
      `SELECT
        bg.ticket_number,
        b.room,
        b.booking_date,
        b.time_slot,
        bg.checked_in,
        bg.checked_in_at,
        b.status,
        bg.full_name as holder_name,
        bg.email as holder_email,
        'guest' as ticket_type
       FROM booking_guests bg
       JOIN bookings b ON bg.booking_id = b.id
       WHERE bg.ticket_number IS NOT NULL
       ${filter === 'used' ? 'AND bg.checked_in = true' : filter === 'unused' ? 'AND bg.checked_in = false' : ''}
       ORDER BY b.booking_date DESC`
    )

    const allTickets = [...hostTickets.rows, ...guestTickets.rows]
      .sort((a, b) => new Date(b.booking_date).getTime() - new Date(a.booking_date).getTime())

    res.status(200).json({
      success: true,
      data: {
        tickets: allTickets.map(t => ({
          ticketNumber: t.ticket_number,
          room: t.room,
          bookingDate: t.booking_date,
          timeSlot: t.time_slot,
          checkedIn: t.checked_in,
          checkedInAt: t.checked_in_at,
          status: t.status,
          holderName: t.holder_name,
          holderEmail: t.holder_email,
          ticketType: t.ticket_type,
        })),
        total: allTickets.length,
        used: allTickets.filter(t => t.checked_in).length,
        unused: allTickets.filter(t => !t.checked_in).length,
      },
    })
  } catch (err) {
    console.error('Get tickets error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}