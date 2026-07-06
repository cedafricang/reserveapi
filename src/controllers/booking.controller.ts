import { Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { query } from '../db'
import { AuthRequest } from '../middleware/auth'
import { awardPoints, checkAndUpgradeTier } from './customer.controller'

import crypto from 'crypto'

import { sendGuestRsvpEmail, sendTicketEmail, sendRescheduleEmail, sendInternalBookingAlert } from '../utils/email'

// ── Constants ─────────────────────────────────────────────────
const ROOM_PRICES: Record<string, number> = {
  'private-cinema': 500000,
  'hi-fi-room': 450000,
  'media-room': 450000,
}

const REFRESHMENT_PRICES: Record<string, number> = {
  'none': 0,
  'curated-snacks': 35000,
  'cocktails-platters': 75000,
  'bespoke': 0,
}

const POINTS_REDEMPTION: Record<string, number> = {
  'private-cinema': 6000,
  'hi-fi-room': 5000,
  'media-room': 5000,
}

const VALID_ROOMS = ['private-cinema', 'hi-fi-room', 'media-room']
const VALID_REFRESHMENTS = ['none', 'curated-snacks', 'cocktails-platters', 'bespoke']

// ── CHECK AVAILABILITY ────────────────────────────────────────
export const checkAvailability = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { room, date } = req.query

    if (!room || !date) {
      res.status(400).json({
        success: false,
        message: 'Room and date are required.',
      })
      return
    }

    if (!VALID_ROOMS.includes(room as string)) {
      res.status(400).json({
        success: false,
        message: 'Invalid room. Must be private-cinema, hi-fi-room, or media-room.',
      })
      return
    }

    // Get booked slots for this room and date
    const bookedSlots = await query(
      `SELECT time_slot FROM bookings
       WHERE room = $1
       AND booking_date = $2
       AND status != 'cancelled'`,
      [room, date]
    )

    const taken = bookedSlots.rows.map((r: { time_slot: string }) => r.time_slot)

    // Validate day of week — only Tue-Sun
    const requestedDate = new Date(date + 'T12:00:00')
    const dayOfWeek = requestedDate.getDay() // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat

    if (dayOfWeek === 1) {
      // Monday — closed
      res.status(200).json({
        success: true,
        message: 'Availability retrieved.',
        data: { room, date, slots: [], totalAvailable: 0, closed: true, reason: 'Soundhous Reserve is closed on Mondays.' },
      })
      return
    }

    // Enforce 2-day advance booking
    const twoDaysFromNow = new Date()
    twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2)
    twoDaysFromNow.setHours(0, 0, 0, 0)

    if (requestedDate < twoDaysFromNow) {
      res.status(200).json({
        success: true,
        message: 'Availability retrieved.',
        data: { room, date, slots: [], totalAvailable: 0, closed: true, reason: 'Bookings must be made at least 2 days in advance.' },
      })
      return
    }

    // Slots by day — Tue-Fri: 4pm-10pm, Sat-Sun: 10am-12am
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

    const WEEKDAY_SLOTS = ['4:00pm', '6:00pm', '8:00pm'] // Tue-Fri evening sessions
    const WEEKEND_SLOTS = ['10:00am', '12:00pm', '2:00pm', '4:00pm', '6:00pm', '8:00pm', '10:00pm'] // Sat-Sun full day

    const ALL_SLOTS: Record<string, string[]> = {
      'private-cinema': isWeekend ? WEEKEND_SLOTS : WEEKDAY_SLOTS,
      'hi-fi-room': isWeekend ? WEEKEND_SLOTS : WEEKDAY_SLOTS,
      'media-room': isWeekend ? WEEKEND_SLOTS : WEEKDAY_SLOTS,
    }

    const slots = ALL_SLOTS[room as string].map(slot => ({
      time: slot,
      available: !taken.includes(slot),
    }))

    res.status(200).json({
      success: true,
      message: 'Availability retrieved.',
      data: {
        room,
        date,
        slots,
        totalAvailable: slots.filter(s => s.available).length,
      },
    })
  } catch (err) {
    console.error('Check availability error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

// ── INITIATE CASH BOOKING (Step 1 — create pending, get Paystack URL) ──
export const initiateCashBooking = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { room, date, timeSlot, guestCount, refreshment } = req.body
    const customerId = req.customer?.customerId

    // Validate
    if (!room || !date || !timeSlot) {
      res.status(400).json({
        success: false,
        message: 'Room, date, and time slot are required.',
      })
      return
    }
    // Validate booking rules
    const bookingDate = new Date(date + 'T12:00:00')
    const dayOfWeek = bookingDate.getDay()

    if (dayOfWeek === 1) {
      res.status(400).json({ success: false, message: 'Soundhous Reserve is closed on Mondays. Please choose another day.' })
      return
    }

    const twoDaysFromNow = new Date()
    twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2)
    twoDaysFromNow.setHours(0, 0, 0, 0)

    if (bookingDate < twoDaysFromNow) {
      res.status(400).json({ success: false, message: 'Bookings must be made at least 2 days in advance.' })
      return
    }

    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
    const validSlots = isWeekend
      ? ['10:00am', '12:00pm', '2:00pm', '4:00pm', '6:00pm', '8:00pm', '10:00pm']
      : ['4:00pm', '6:00pm', '8:00pm']

    if (!validSlots.includes(timeSlot)) {
      res.status(400).json({ success: false, message: 'Invalid time slot for the selected day.' })
      return
    }

    if (!VALID_ROOMS.includes(room)) {
      res.status(400).json({ success: false, message: 'Invalid room.' })
      return
    }

    const refreshmentChoice = refreshment || 'none'
    if (!VALID_REFRESHMENTS.includes(refreshmentChoice)) {
      res.status(400).json({ success: false, message: 'Invalid refreshment option.' })
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
        message: 'That time slot is no longer available. Please choose another.',
      })
      return
    }

    // Get customer email for Paystack
    const customerResult = await query(
      'SELECT email, first_name FROM customers WHERE id = $1',
      [customerId]
    )

    if (customerResult.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Customer not found.' })
      return
    }

    const roomPrice = ROOM_PRICES[room]
    const refreshmentPrice = REFRESHMENT_PRICES[refreshmentChoice]
    const totalAmount = roomPrice + refreshmentPrice
    const paystackReference = `RSV-${uuidv4().replace(/-/g, '').slice(0, 16).toUpperCase()}`

    // Initialize Paystack transaction
    const paystackResponse = await fetch(
      'https://api.paystack.co/transaction/initialize',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: customerResult.rows[0].email,
          amount: totalAmount * 100, // Paystack uses kobo
          reference: paystackReference,
          currency: 'NGN',
          callback_url: `${process.env.FRONTEND_URL}/book/verify?reference=${paystackReference}`,
          metadata: {
            customerId,
            room,
            date,
            timeSlot,
            guestCount: guestCount || 1,
            refreshment: refreshmentChoice,
            roomPrice,
            refreshmentPrice,
          },
        }),
      }
    )

    const paystackData = await paystackResponse.json() as {
      status: boolean
      data: { authorization_url: string; access_code: string; reference: string }
    }

    if (!paystackData.status) {
      res.status(502).json({
        success: false,
        message: 'Payment initialization failed. Please try again.',
      })
      return
    }

    res.status(200).json({
      success: true,
      message: 'Payment initialized. Redirect customer to authorization URL.',
      data: {
        authorizationUrl: paystackData.data.authorization_url,
        reference: paystackReference,
        amount: totalAmount,
        breakdown: {
          roomPrice,
          refreshmentPrice,
          total: totalAmount,
        },
      },
    })
  } catch (err) {
    console.error('Initiate cash booking error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

// ── VERIFY PAYMENT AND CONFIRM BOOKING ────────────────────────
export const verifyAndConfirmBooking = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { reference } = req.body
    const customerId = req.customer?.customerId

    if (!reference) {
      res.status(400).json({ success: false, message: 'Payment reference is required.' })
      return
    }

    // Verify with Paystack
    const paystackResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    )

    const paystackData = await paystackResponse.json() as {
      status: boolean
      data: {
        status: string
        amount: number
        metadata: {
          customerId: string
          room: string
          date: string
          timeSlot: string
          guestCount: number
          refreshment: string
          roomPrice: number
          refreshmentPrice: number
        }
      }
    }

    if (!paystackData.status || paystackData.data.status !== 'success') {
      res.status(402).json({
        success: false,
        message: 'Payment was not successful. Please try again.',
      })
      return
    }

    const meta = paystackData.data.metadata

    // Security check — ensure the customer matches
    if (meta.customerId !== customerId) {
      res.status(403).json({
        success: false,
        message: 'Payment verification failed.',
      })
      return
    }

    // Check slot is still available (race condition protection)
    const existing = await query(
      `SELECT id FROM bookings
       WHERE room = $1 AND booking_date = $2 AND time_slot = $3
       AND status != 'cancelled'`,
      [meta.room, meta.date, meta.timeSlot]
    )

    if (existing.rows.length > 0) {
      // Slot was taken during payment — will need to handle refund separately
      res.status(409).json({
        success: false,
        message: 'The time slot was taken while you were paying. Please contact us on WhatsApp for a full refund.',
      })
      return
    }

    // Create confirmed booking
    const bookingId = uuidv4()
    const bookingResult = await query(
      `INSERT INTO bookings (
        id, customer_id, room, booking_date, time_slot,
        guest_count, payment_type, amount_paid, paystack_reference,
        refreshment, refreshment_amount, points_used, status,
        reschedule_count, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, 'cash', $7, $8,
        $9, $10, 0, 'confirmed',
        0, NOW(), NOW()
      ) RETURNING *`,
      [
        bookingId,
        customerId,
        meta.room,
        meta.date,
        meta.timeSlot,
        meta.guestCount || 1,
       Number(meta.roomPrice) + Number(meta.refreshmentPrice),
        reference,
        meta.refreshment,
        Number(meta.refreshmentPrice),
      ]
    )
    const ticketNumber = generateTicketNumber(meta.room)
await query(`UPDATE bookings SET ticket_number = $1 WHERE id = $2`, [ticketNumber, bookingResult.rows[0].id])

const hostResult = await query('SELECT first_name, last_name, email FROM customers WHERE id = $1', [customerId])
const hostInfo = hostResult.rows[0]
await sendTicketEmail(
  hostInfo.email,
  `${hostInfo.first_name} ${hostInfo.last_name}`,
  ticketNumber,
  meta.room,
  meta.date,
  meta.timeSlot,
  `${hostInfo.first_name} ${hostInfo.last_name}`,
  true
)

await sendInternalBookingAlert('new-booking', {
  customerName: `${hostInfo.first_name} ${hostInfo.last_name}`,
  customerEmail: hostInfo.email,
  room: meta.room,
  date: meta.date,
  timeSlot: meta.timeSlot,
  paymentType: 'cash',
  ticketNumber,
})
    

    // Award points for the session fee (not refreshments)
    const pointsEarned = await awardPoints(
  customerId!,
  Number(meta.roomPrice),
  `Booking: ${meta.room} on ${meta.date}`,
  'earn-booking',
  bookingId
)

// Update annual spend and check tier upgrade
await query(
  `UPDATE customers
   SET annual_spend = annual_spend + $1,
       last_active_at = NOW(),
       updated_at = NOW()
   WHERE id = $2`,
  [Number(meta.roomPrice) + Number(meta.refreshmentPrice), customerId]
)

    await checkAndUpgradeTier(customerId!)
    

    // Award referral points to referrer on first booking
    // Award referral points on first booking
    const referrerCheck1 = await query(
      `SELECT c.referred_by,
        (SELECT COUNT(*) FROM bookings WHERE customer_id = $1 AND status = 'confirmed') as booking_count
       FROM customers c WHERE c.id = $1`,
      [customerId]
    )
    if (referrerCheck1.rows.length > 0) {
      const { referred_by, booking_count } = referrerCheck1.rows[0]
      if (referred_by && Number(booking_count) === 1) {
        await query(`UPDATE customers SET points_balance = points_balance + 50, updated_at = NOW() WHERE id = $1`, [referred_by])
        await query(`INSERT INTO points_transactions (id, customer_id, type, points, description, created_at) VALUES ($1, $2, 'earn-referral-reserve', 50, $3, NOW())`, [uuidv4(), referred_by, `Referral: ${customerId} made their first booking`])
      }
    }
    

    res.status(201).json({
  success: true,
  message: 'Booking confirmed.',
  data: {
    booking: {
      id: bookingResult.rows[0].id,
      room: bookingResult.rows[0].room,
      bookingDate: bookingResult.rows[0].booking_date,
      timeSlot: bookingResult.rows[0].time_slot,
      guestCount: bookingResult.rows[0].guest_count,
      paymentType: bookingResult.rows[0].payment_type,
      amountPaid: Number(bookingResult.rows[0].amount_paid),
      refreshment: bookingResult.rows[0].refreshment,
      status: bookingResult.rows[0].status,
      ticketNumber,
    },
    pointsEarned,
  },
})
  } catch (err) {
    console.error('Verify booking error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}



// ── COMPLIMENTARY TIER BOOKING ────────────────────────────────
export const createComplimentaryBooking = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { room, date, timeSlot, guestCount, refreshment } = req.body
    const customerId = req.customer?.customerId

    if (!room || !date || !timeSlot) {
      res.status(400).json({
        success: false,
        message: 'Room, date, and time slot are required.',
      })
      return
    }
    // Validate booking rules
    const bookingDate = new Date(date + 'T12:00:00')
    const dayOfWeek = bookingDate.getDay()

    if (dayOfWeek === 1) {
      res.status(400).json({ success: false, message: 'Soundhous Reserve is closed on Mondays. Please choose another day.' })
      return
    }

    const twoDaysFromNow = new Date()
    twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2)
    twoDaysFromNow.setHours(0, 0, 0, 0)

    if (bookingDate < twoDaysFromNow) {
      res.status(400).json({ success: false, message: 'Bookings must be made at least 2 days in advance.' })
      return
    }

    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
    const validSlots = isWeekend
      ? ['10:00am', '12:00pm', '2:00pm', '4:00pm', '6:00pm', '8:00pm', '10:00pm']
      : ['4:00pm', '6:00pm', '8:00pm']

    if (!validSlots.includes(timeSlot)) {
      res.status(400).json({ success: false, message: 'Invalid time slot for the selected day.' })
      return
    }

    const COMPLIMENTARY_SESSIONS: Record<string, number> = {
      'reserve-member': 0,
      'silver': 1,
      'gold': 2,
      'platinum': 4,
    }

    // Get customer tier and sessions used
    const customerResult = await query(
      'SELECT tier, complimentary_sessions_used_this_year FROM customers WHERE id = $1',
      [customerId]
    )

    if (customerResult.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Customer not found.' })
      return
    }

    const { tier, complimentary_sessions_used_this_year } = customerResult.rows[0]
    const totalAllowed = COMPLIMENTARY_SESSIONS[tier] || 0
    const used = Number(complimentary_sessions_used_this_year)

    if (totalAllowed === 0) {
      res.status(403).json({
        success: false,
        message: 'Complimentary access is not available on your current tier. Upgrade to Silver or above.',
      })
      return
    }

    if (used >= totalAllowed) {
      res.status(403).json({
        success: false,
        message: `You have used all ${totalAllowed} complimentary session${totalAllowed > 1 ? 's' : ''} for this year.`,
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
        message: 'That time slot is no longer available.',
      })
      return
    }

    const refreshmentChoice = refreshment || 'none'
    const refreshmentPrice = REFRESHMENT_PRICES[refreshmentChoice] || 0

    // Create booking
    const bookingId = uuidv4()
    const bookingResult = await query(
      `INSERT INTO bookings (
        id, customer_id, room, booking_date, time_slot,
        guest_count, payment_type, amount_paid,
        refreshment, refreshment_amount, points_used, status,
        reschedule_count, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, 'complimentary-tier', 0,
        $7, $8, 0, 'confirmed',
        0, NOW(), NOW()
      ) RETURNING *`,
      [
        bookingId,
        customerId,
        room,
        date,
        timeSlot,
        guestCount || 1,
        refreshmentChoice,
        refreshmentPrice,
      ]
    )
    const ticketNumber = generateTicketNumber(room)
await query(`UPDATE bookings SET ticket_number = $1 WHERE id = $2`, [ticketNumber, bookingResult.rows[0].id])

const hostResult = await query('SELECT first_name, last_name, email FROM customers WHERE id = $1', [customerId])
const hostInfo = hostResult.rows[0]
await sendTicketEmail(
  hostInfo.email,
  `${hostInfo.first_name} ${hostInfo.last_name}`,
  ticketNumber,
  room,
  date,
  timeSlot,
  `${hostInfo.first_name} ${hostInfo.last_name}`,
  true
)
console.log('Ticket number before alert:', ticketNumber)
await sendInternalBookingAlert('new-booking', {
  customerName: `${hostInfo.first_name} ${hostInfo.last_name}`,
  customerEmail: hostInfo.email,
  room,
  date,
  timeSlot,
  paymentType: 'complimentary-tier',
  ticketNumber,
})

    // Increment sessions used
    await query(
      `UPDATE customers
       SET complimentary_sessions_used_this_year = complimentary_sessions_used_this_year + 1,
           last_active_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [customerId]
    )
    

    await query(
      `UPDATE customers
       SET complimentary_sessions_used_this_year = complimentary_sessions_used_this_year + 1,
           last_active_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [customerId]
    )

    // Award referral points to referrer on first booking
    // Award referral points on first booking
    const referrerCheck2 = await query(
      `SELECT c.referred_by,
        (SELECT COUNT(*) FROM bookings WHERE customer_id = $1 AND status = 'confirmed') as booking_count
       FROM customers c WHERE c.id = $1`,
      [customerId]
    )
    if (referrerCheck2.rows.length > 0) {
      const { referred_by, booking_count } = referrerCheck2.rows[0]
      if (referred_by && Number(booking_count) === 1) {
        await query(`UPDATE customers SET points_balance = points_balance + 50, updated_at = NOW() WHERE id = $1`, [referred_by])
        await query(`INSERT INTO points_transactions (id, customer_id, type, points, description, created_at) VALUES ($1, $2, 'earn-referral-reserve', 50, $3, NOW())`, [uuidv4(), referred_by, `Referral: ${customerId} made their first booking`])
      }
    }
    

    res.status(201).json({
      success: true,
      message: 'Complimentary booking confirmed.',
      data: {
        booking: {
          id: bookingResult.rows[0].id,
          room: bookingResult.rows[0].room,
          bookingDate: bookingResult.rows[0].booking_date,
          timeSlot: bookingResult.rows[0].time_slot,
          guestCount: bookingResult.rows[0].guest_count,
          paymentType: bookingResult.rows[0].payment_type,
          amountPaid: 0,
          refreshment: bookingResult.rows[0].refreshment,
          status: bookingResult.rows[0].status,
          ticketNumber,
        },
        sessionsRemaining: totalAllowed - used - 1,
      },
    })
  } catch (err) {
    console.error('Complimentary booking error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

// ── POINTS REDEMPTION BOOKING ─────────────────────────────────
export const createPointsBooking = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { room, date, timeSlot, guestCount, refreshment } = req.body
    const customerId = req.customer?.customerId

    if (!room || !date || !timeSlot) {
      res.status(400).json({
        success: false,
        message: 'Room, date, and time slot are required.',
      })
      return
    }
    // Validate booking rules
    const bookingDate = new Date(date + 'T12:00:00')
    const dayOfWeek = bookingDate.getDay()

    if (dayOfWeek === 1) {
      res.status(400).json({ success: false, message: 'Soundhous Reserve is closed on Mondays. Please choose another day.' })
      return
    }

    const twoDaysFromNow = new Date()
    twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2)
    twoDaysFromNow.setHours(0, 0, 0, 0)

    if (bookingDate < twoDaysFromNow) {
      res.status(400).json({ success: false, message: 'Bookings must be made at least 2 days in advance.' })
      return
    }

    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
    const validSlots = isWeekend
      ? ['10:00am', '12:00pm', '2:00pm', '4:00pm', '6:00pm', '8:00pm', '10:00pm']
      : ['4:00pm', '6:00pm', '8:00pm']

    if (!validSlots.includes(timeSlot)) {
      res.status(400).json({ success: false, message: 'Invalid time slot for the selected day.' })
      return
    }

    if (!VALID_ROOMS.includes(room)) {
      res.status(400).json({ success: false, message: 'Invalid room.' })
      return
    }

    const pointsRequired = POINTS_REDEMPTION[room]

    // Get customer points balance
    const customerResult = await query(
      'SELECT points_balance FROM customers WHERE id = $1',
      [customerId]
    )

    if (customerResult.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Customer not found.' })
      return
    }

    const pointsBalance = Number(customerResult.rows[0].points_balance)

    if (pointsBalance < pointsRequired) {
      res.status(403).json({
        success: false,
        message: `Insufficient points. You have ${pointsBalance} points. ${room === 'private-cinema' ? 'Private Cinema' : room === 'hi-fi-room' ? 'Hi-Fi Room' : 'Media Room'} requires ${pointsRequired} points.`,
        data: {
          currentBalance: pointsBalance,
          required: pointsRequired,
          shortfall: pointsRequired - pointsBalance,
        },
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
        message: 'That time slot is no longer available.',
      })
      return
    }

    const refreshmentChoice = refreshment || 'none'
    const refreshmentPrice = REFRESHMENT_PRICES[refreshmentChoice] || 0

    // Atomic: deduct points and create booking in one transaction
    const client = await query('BEGIN')
    try {
      // Deduct points
      await query(
        `UPDATE customers
         SET points_balance = points_balance - $1,
             last_active_at = NOW(),
             updated_at = NOW()
         WHERE id = $2 AND points_balance >= $1`,
        [pointsRequired, customerId]
      )

      // Create booking
      const bookingId = uuidv4()
      const bookingResult = await query(
        `INSERT INTO bookings (
          id, customer_id, room, booking_date, time_slot,
          guest_count, payment_type, amount_paid,
          refreshment, refreshment_amount, points_used, status,
          reschedule_count, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, 'points', 0,
          $7, $8, $9, 'confirmed',
          0, NOW(), NOW()
        ) RETURNING *`,
        [
          bookingId,
          customerId,
          room,
          date,
          timeSlot,
          guestCount || 1,
          refreshmentChoice,
          refreshmentPrice,
          pointsRequired,
        ]
      )
      const ticketNumber = generateTicketNumber(room)
await query(`UPDATE bookings SET ticket_number = $1 WHERE id = $2`, [ticketNumber, bookingResult.rows[0].id])

const hostResult = await query('SELECT first_name, last_name, email FROM customers WHERE id = $1', [customerId])
const hostInfo = hostResult.rows[0]
await sendTicketEmail(
  hostInfo.email,
  `${hostInfo.first_name} ${hostInfo.last_name}`,
  ticketNumber,
  room,
  date,
  timeSlot,
  `${hostInfo.first_name} ${hostInfo.last_name}`,
  true
)
await sendInternalBookingAlert('new-booking', {
  customerName: `${hostInfo.first_name} ${hostInfo.last_name}`,
  customerEmail: hostInfo.email,
  room,
  date,
  timeSlot,
  paymentType: 'points',
  ticketNumber,
})

      // Record points transaction
      await query(
        `INSERT INTO points_transactions
           (id, customer_id, type, points, description, reference_id, created_at)
         VALUES ($1, $2, 'redeem-booking', $3, $4, $5, NOW())`,
        [
          uuidv4(),
          customerId,
          -pointsRequired,
          `Redeemed: ${room} on ${date}`,
          bookingId,
        ]
      )

      await query('COMMIT')

      // Award referral points on first booking
      const referrerCheck3 = await query(
        `SELECT c.referred_by,
          (SELECT COUNT(*) FROM bookings WHERE customer_id = $1 AND status = 'confirmed') as booking_count
         FROM customers c WHERE c.id = $1`,
        [customerId]
      )
      if (referrerCheck3.rows.length > 0) {
        const { referred_by, booking_count } = referrerCheck3.rows[0]
        if (referred_by && Number(booking_count) === 1) {
          await query(`UPDATE customers SET points_balance = points_balance + 50, updated_at = NOW() WHERE id = $1`, [referred_by])
          await query(`INSERT INTO points_transactions (id, customer_id, type, points, description, created_at) VALUES ($1, $2, 'earn-referral-reserve', 50, $3, NOW())`, [uuidv4(), referred_by, `Referral: ${customerId} made their first booking`])
        }
      }

       

      // Get updated balance
      const updatedCustomer = await query(
        'SELECT points_balance FROM customers WHERE id = $1',
        [customerId]
      )

      res.status(201).json({
        success: true,
        message: 'Room booked with points.',
        data: {
          booking: {
            id: bookingResult.rows[0].id,
            room: bookingResult.rows[0].room,
            bookingDate: bookingResult.rows[0].booking_date,
            timeSlot: bookingResult.rows[0].time_slot,
            guestCount: bookingResult.rows[0].guest_count,
            paymentType: bookingResult.rows[0].payment_type,
            pointsUsed: pointsRequired,
            refreshment: bookingResult.rows[0].refreshment,
            status: bookingResult.rows[0].status,
            ticketNumber,
          },
          pointsUsed: pointsRequired,
          remainingBalance: Number(updatedCustomer.rows[0].points_balance),
        },
      })
    } catch (txErr) {
      await query('ROLLBACK')
      throw txErr
    }
  } catch (err) {
    console.error('Points booking error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

// ── RESCHEDULE BOOKING ────────────────────────────────────────
export const rescheduleBooking = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { bookingId } = req.params
    const { newDate, newTimeSlot } = req.body
    const customerId = req.customer?.customerId

    if (!newDate || !newTimeSlot) {
      res.status(400).json({
        success: false,
        message: 'New date and time slot are required.',
      })
      return
    }

    // Get the booking
    const bookingResult = await query(
      `SELECT * FROM bookings WHERE id = $1 AND customer_id = $2`,
      [bookingId, customerId]
    )

    if (bookingResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        message: 'Booking not found.',
      })
      return
    }

    const booking = bookingResult.rows[0]

    // Check reschedule count
    if (booking.reschedule_count >= 2) {
      res.status(403).json({
        success: false,
        message: 'This booking has reached the maximum number of reschedules. Please contact us on WhatsApp for assistance.',
      })
      return
    }

    // Check 48 hour rule
    const sessionDateTime = new Date(`${booking.booking_date}T${
      booking.time_slot.includes('am') || booking.time_slot.includes('pm')
        ? convertTo24Hour(booking.time_slot)
        : booking.time_slot
    }`)
    const hoursUntilSession = (sessionDateTime.getTime() - Date.now()) / (1000 * 60 * 60)

    if (hoursUntilSession < 48) {
      res.status(403).json({
        success: false,
        message: 'Rescheduling is not available within 48 hours of your session. Please contact us on WhatsApp for assistance.',
      })
      return
    }

    // Check new slot availability
    const existing = await query(
      `SELECT id FROM bookings
       WHERE room = $1 AND booking_date = $2 AND time_slot = $3
       AND status != 'cancelled' AND id != $4`,
      [booking.room, newDate, newTimeSlot, bookingId]
    )

    if (existing.rows.length > 0) {
      res.status(409).json({
        success: false,
        message: 'That time slot is not available. Please choose another.',
      })
      return
    }

    // Update booking
    const updated = await query(
      `UPDATE bookings
       SET booking_date = $1,
           time_slot = $2,
           status = 'rescheduled',
           reschedule_count = reschedule_count + 1,
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [newDate, newTimeSlot, bookingId]
    )

    // Get host details
    const hostResult = await query(
      'SELECT first_name, last_name, email FROM customers WHERE id = $1',
      [customerId]
    )
    const host = hostResult.rows[0]
    const oldDate = booking.booking_date
    const oldTimeSlot = booking.time_slot

    // Email host
    await sendRescheduleEmail(
      host.email,
      `${host.first_name} ${host.last_name}`,
      booking.room,
      oldDate,
      oldTimeSlot,
      newDate,
      newTimeSlot,
      true
    )

    // Email all confirmed guests
    const guestsResult = await query(
      `SELECT full_name, email FROM booking_guests 
       WHERE booking_id = $1 AND rsvp_status = 'accepted'`,
      [bookingId]
    )
    for (const guest of guestsResult.rows) {
      await sendRescheduleEmail(
        guest.email,
        guest.full_name,
        booking.room,
        oldDate,
        oldTimeSlot,
        newDate,
        newTimeSlot,
        false
      )
    }

    // Internal team notification
    await sendInternalBookingAlert('new-booking', {
      customerName: `${host.first_name} ${host.last_name}`,
      customerEmail: host.email,
      room: booking.room,
      date: newDate,
      timeSlot: newTimeSlot,
      paymentType: `rescheduled (was ${oldDate} ${oldTimeSlot})`,
    })

    res.status(200).json({
      success: true,
      message: 'Booking rescheduled.',
      data: {
        booking: {
          id: updated.rows[0].id,
          room: updated.rows[0].room,
          bookingDate: updated.rows[0].booking_date,
          timeSlot: updated.rows[0].time_slot,
          status: updated.rows[0].status,
          rescheduleCount: updated.rows[0].reschedule_count,
          reschedulesRemaining: 2 - updated.rows[0].reschedule_count,
        },
      },
    })
  } catch (err) {
    console.error('Reschedule error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

// ── GET SINGLE BOOKING ────────────────────────────────────────
export const getBooking = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { bookingId } = req.params
    const customerId = req.customer?.customerId

    const result = await query(
      'SELECT * FROM bookings WHERE id = $1 AND customer_id = $2',
      [bookingId, customerId]
    )

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Booking not found.' })
      return
    }

    const b = result.rows[0]
    res.status(200).json({
      success: true,
      message: 'Booking retrieved.',
      data: {
        booking: {
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
          reschedulesRemaining: Math.max(0, 2 - b.reschedule_count),
          createdAt: b.created_at,
        },
      },
    })
  } catch (err) {
    console.error('Get booking error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

// ── HELPER ────────────────────────────────────────────────────
const convertTo24Hour = (time: string): string => {
  const [timePart, modifier] = time.split(/(am|pm)/i).filter(Boolean)
  let [hours, minutes] = timePart.split(':').map(Number)
  if (!minutes) minutes = 0
  if (modifier?.toLowerCase() === 'pm' && hours !== 12) hours += 12
  if (modifier?.toLowerCase() === 'am' && hours === 12) hours = 0
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`
}

const TICKET_PREFIX: Record<string, string> = {
  'private-cinema': 'SHCINEMA',
  'hi-fi-room': 'SHHIFI',
  'media-room': 'SHMEDIA',
}

const generateTicketNumber = (room: string): string => {
  const prefix = TICKET_PREFIX[room] || 'SHRESERVE'
  const random = Math.floor(10000 + Math.random() * 90000) // 5-digit
  return `${prefix}-${random}`
}

// ── IKOYI CLUB MEMBERSHIP VERIFICATION ───────────────────────
export const verifyIkoyiMembership = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { membershipNumber } = req.body

    if (!membershipNumber) {
      res.status(400).json({ success: false, message: 'Membership number is required.' })
      return
    }

    // Find the club
    const clubResult = await query(
      'SELECT id FROM clubs WHERE slug = $1 AND active = true',
      ['ikoyi']
    )

    if (clubResult.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Club partnership not active.' })
      return
    }

    const clubId = clubResult.rows[0].id

    // Find the membership
    const memberResult = await query(
      'SELECT * FROM club_members WHERE club_id = $1 AND membership_number ILIKE $2',
      [clubId, membershipNumber.trim()]
    )

    if (memberResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        message: 'Membership number not found.',
      })
      return
    }

    const member = memberResult.rows[0]

    res.status(200).json({
      success: true,
      message: 'Membership verified.',
      data: {
        membershipNumber: member.membership_number,
        complimentaryAvailable: !member.complimentary_used,
        discountPercent: 20,
      },
    })
  } catch (err) {
    console.error('Ikoyi verification error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}


// ── INVITE GUESTS ─────────────────────────────────────────────
export const inviteGuests = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { bookingId } = req.params
    const { guests } = req.body // [{ fullName, email }]
    const customerId = req.customer?.customerId

    if (!Array.isArray(guests) || guests.length === 0) {
      res.status(400).json({ success: false, message: 'At least one guest is required.' })
      return
    }

    const bookingResult = await query(
      `SELECT b.*, c.first_name, c.last_name
       FROM bookings b
       JOIN customers c ON b.customer_id = c.id
       WHERE b.id = $1 AND b.customer_id = $2`,
      [bookingId, customerId]
    )

    if (bookingResult.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Booking not found.' })
      return
    }

    const booking = bookingResult.rows[0]
    const hostName = `${booking.first_name} ${booking.last_name}`

    const inserted = []
    for (const guest of guests) {
      if (!guest.fullName || !guest.email) continue
      const guestId = uuidv4()
      const rsvpToken = crypto.randomBytes(24).toString('hex')

      await query(
        `INSERT INTO booking_guests (id, booking_id, full_name, email, rsvp_status, rsvp_token, invited_at)
         VALUES ($1, $2, $3, $4, 'pending', $5, NOW())`,
        [guestId, bookingId, guest.fullName.trim(), guest.email.trim().toLowerCase(), rsvpToken]
      )

      await sendGuestRsvpEmail(
        guest.email.trim().toLowerCase(),
        guest.fullName.trim(),
        hostName,
        booking.room,
        booking.booking_date,
        booking.time_slot,
        rsvpToken
      )

      inserted.push({ id: guestId, fullName: guest.fullName, email: guest.email })
    }

    res.status(201).json({
      success: true,
      message: `${inserted.length} guest invitation(s) sent.`,
      data: { guests: inserted },
    })
  } catch (err) {
    console.error('Invite guests error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

// ── RSVP RESPONSE (public, no auth — guest clicks email link) ──
export const getRsvpDetails = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { token } = req.params
    const result = await query(
      `SELECT bg.*, b.room, b.booking_date, b.time_slot, c.first_name, c.last_name
       FROM booking_guests bg
       JOIN bookings b ON bg.booking_id = b.id
       JOIN customers c ON b.customer_id = c.id
       WHERE bg.rsvp_token = $1`,
      [token]
    )

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Invitation not found.' })
      return
    }

    const r = result.rows[0]
    res.status(200).json({
      success: true,
      data: {
        guestName: r.full_name,
        hostName: `${r.first_name} ${r.last_name}`,
        room: r.room,
        bookingDate: r.booking_date,
        timeSlot: r.time_slot,
        rsvpStatus: r.rsvp_status,
      },
    })
  } catch (err) {
    console.error('Get RSVP error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

export const respondToRsvp = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { token } = req.params
    const { status } = req.body // 'accepted' | 'declined'

    if (!['accepted', 'declined'].includes(status)) {
      res.status(400).json({ success: false, message: 'Invalid status.' })
      return
    }

    const guestResult = await query(
      `SELECT bg.*, b.room, b.booking_date, b.time_slot, c.first_name, c.last_name
       FROM booking_guests bg
       JOIN bookings b ON bg.booking_id = b.id
       JOIN customers c ON b.customer_id = c.id
       WHERE bg.rsvp_token = $1`,
      [token]
    )

    if (guestResult.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Invitation not found.' })
      return
    }

    const guest = guestResult.rows[0]
    let ticketNumber: string | null = guest.ticket_number

    if (status === 'accepted' && !ticketNumber) {
      ticketNumber = generateTicketNumber(guest.room)
    }

    await query(
      `UPDATE booking_guests
       SET rsvp_status = $1, responded_at = NOW(), ticket_number = COALESCE($2, ticket_number)
       WHERE rsvp_token = $3`,
      [status, ticketNumber, token]
    )

    if (status === 'accepted' && ticketNumber) {
      await sendTicketEmail(
        guest.email,
        guest.full_name,
        ticketNumber,
        guest.room,
        guest.booking_date,
        guest.time_slot,
        `${guest.first_name} ${guest.last_name}`,
        false
      )
      await sendInternalBookingAlert('rsvp-accepted', {
        customerName: `${guest.first_name} ${guest.last_name}`,
        customerEmail: '',
        room: guest.room,
        date: guest.booking_date,
        timeSlot: guest.time_slot,
        guestName: guest.full_name,
        guestEmail: guest.email,
      })
    }

    if (status === 'declined') {
      await sendInternalBookingAlert('rsvp-declined', {
        customerName: `${guest.first_name} ${guest.last_name}`,
        customerEmail: '',
        room: guest.room,
        date: guest.booking_date,
        timeSlot: guest.time_slot,
        guestName: guest.full_name,
        guestEmail: guest.email,
      })
    }

    res.status(200).json({
      success: true,
      message: `RSVP recorded as ${status}.`,
      data: { ticketNumber: status === 'accepted' ? ticketNumber : null },
    })

  } catch (err) {
    console.error('Respond to RSVP error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}
// ── GET BOOKING GUESTS ────────────────────────────────────────
export const getBookingGuests = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { bookingId } = req.params
    const customerId = req.customer?.customerId

    const ownerCheck = await query(
      'SELECT id FROM bookings WHERE id = $1 AND customer_id = $2',
      [bookingId, customerId]
    )
    if (ownerCheck.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Booking not found.' })
      return
    }

    const result = await query(
      `SELECT id, full_name, email, rsvp_status, invited_at, responded_at
       FROM booking_guests WHERE booking_id = $1 ORDER BY invited_at ASC`,
      [bookingId]
    )

    res.status(200).json({
      success: true,
      data: { guests: result.rows.map(g => ({
        id: g.id,
        fullName: g.full_name,
        email: g.email,
        rsvpStatus: g.rsvp_status,
        invitedAt: g.invited_at,
        respondedAt: g.responded_at,
      })) },
    })
  } catch (err) {
    console.error('Get booking guests error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}