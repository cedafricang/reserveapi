import { Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { query } from '../db'
import { AuthRequest } from '../middleware/auth'
import { awardPoints, checkAndUpgradeTier } from './customer.controller'

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

    // All possible slots per room
    const ALL_SLOTS: Record<string, string[]> = {
      'private-cinema': ['10:00am', '2:00pm', '6:00pm'],
      'hi-fi-room': ['10:00am', '12:00pm', '2:00pm', '4:00pm', '6:00pm'],
      'media-room': ['10:00am', '1:00pm', '4:00pm', '7:00pm'],
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
        meta.roomPrice + meta.refreshmentPrice,
        reference,
        meta.refreshment,
        meta.refreshmentPrice,
      ]
    )

    // Award points for the session fee (not refreshments)
    const pointsEarned = await awardPoints(
      customerId!,
      meta.roomPrice,
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
      [meta.roomPrice + meta.refreshmentPrice, customerId]
    )

    await checkAndUpgradeTier(customerId!)

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

    // Increment sessions used
    await query(
      `UPDATE customers
       SET complimentary_sessions_used_this_year = complimentary_sessions_used_this_year + 1,
           last_active_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [customerId]
    )

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