import { Router } from 'express'
import {
  checkAvailability,
  initiateCashBooking,
  verifyAndConfirmBooking,
  createComplimentaryBooking,
  createPointsBooking,
  rescheduleBooking,
  
  getBooking,
  inviteGuests,
  getRsvpDetails,
  respondToRsvp,
  getBookingGuests,
} from '../controllers/booking.controller'
import { requireAuth } from '../middleware/auth'



const router = Router()

// Public — check availability without login
router.get('/availability', checkAvailability)


// Protected — all booking actions require auth
router.post('/cash', requireAuth, initiateCashBooking)
router.post('/verify', requireAuth, verifyAndConfirmBooking)
router.post('/complimentary', requireAuth, createComplimentaryBooking)
router.post('/points', requireAuth, createPointsBooking)
router.get('/:bookingId', requireAuth, getBooking)
router.patch('/:bookingId/reschedule', requireAuth, rescheduleBooking)

export default router

// Guest invitations
router.post('/:bookingId/guests', requireAuth, inviteGuests)
router.get('/:bookingId/guests', requireAuth, getBookingGuests)

// Public RSVP (guest clicks link from email — no login)
router.get('/rsvp/:token', getRsvpDetails)
router.post('/rsvp/:token/respond', respondToRsvp)