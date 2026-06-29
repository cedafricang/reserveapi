import { Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { query } from '../db'
import { AuthRequest } from '../middleware/auth'
import { checkAndUpgradeTier } from './customer.controller'

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
          customerName: `${b.first_name || ''} ${b.last_name || ''}`.trim(),
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
          customerName: `${b.first_name || ''} ${b.last_name || ''}`.trim(),
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
export const getClubMembers = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { clubSlug } = req.params
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20)
    const offset = (page - 1) * limit

    const clubResult = await query(
      'SELECT * FROM clubs WHERE slug = $1',
      [clubSlug]
    )

    if (clubResult.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Club not found.' })
      return
    }

    const club = clubResult.rows[0]

    const [members, countResult, stats] = await Promise.all([
      query(
        `SELECT cm.*, c.email, c.first_name, c.last_name, c.tier
         FROM club_members cm
         LEFT JOIN customers c ON cm.customer_id = c.id
         WHERE cm.club_id = $1
         ORDER BY cm.created_at DESC
         LIMIT $2 OFFSET $3`,
        [club.id, limit, offset]
      ),
      query(
        'SELECT COUNT(*) FROM club_members WHERE club_id = $1',
        [club.id]
      ),
      query(
        `SELECT
           COUNT(*) as total_members,
           SUM(CASE WHEN complimentary_used = true THEN 1 ELSE 0 END) as used_complimentary,
           SUM(CASE WHEN customer_id IS NOT NULL THEN 1 ELSE 0 END) as converted_to_reserve
         FROM club_members
         WHERE club_id = $1`,
        [club.id]
      ),
    ])

    const total = parseInt(countResult.rows[0].count)

    res.status(200).json({
      success: true,
      message: 'Club members retrieved.',
      data: {
        club: {
          id: club.id,
          name: club.name,
          slug: club.slug,
          discountPercent: club.discount_percent,
          active: club.active,
        },
        stats: {
          totalMembers: Number(stats.rows[0].total_members),
          usedComplimentary: Number(stats.rows[0].used_complimentary),
          convertedToReserve: Number(stats.rows[0].converted_to_reserve),
        },
        members: members.rows.map(m => ({
          id: m.id,
          membershipNumber: m.membership_number,
          complimentaryUsed: m.complimentary_used,
          complimentaryUsedAt: m.complimentary_used_at,
          customerEmail: m.email,
          customerName: m.first_name ? `${m.first_name} ${m.last_name}` : null,
          customerTier: m.tier,
          createdAt: m.created_at,
        })),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    })
  } catch (err) {
    console.error('Get club members error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

// ── ADD CLUB MEMBER ───────────────────────────────────────────
export const addClubMember = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { clubSlug } = req.params
    const { membershipNumber } = req.body

    if (!membershipNumber) {
      res.status(400).json({
        success: false,
        message: 'Membership number is required.',
      })
      return
    }

    const clubResult = await query(
      'SELECT id FROM clubs WHERE slug = $1',
      [clubSlug]
    )

    if (clubResult.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Club not found.' })
      return
    }

    const clubId = clubResult.rows[0].id

    // Check if already exists
    const existing = await query(
      'SELECT id FROM club_members WHERE club_id = $1 AND membership_number ILIKE $2',
      [clubId, membershipNumber.trim()]
    )

    if (existing.rows.length > 0) {
      res.status(409).json({
        success: false,
        message: 'This membership number is already registered.',
      })
      return
    }

    const result = await query(
      `INSERT INTO club_members (id, club_id, membership_number, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       RETURNING *`,
      [uuidv4(), clubId, membershipNumber.trim().toUpperCase()]
    )

    res.status(201).json({
      success: true,
      message: 'Club member added.',
      data: { member: result.rows[0] },
    })
  } catch (err) {
    console.error('Add club member error:', err)
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