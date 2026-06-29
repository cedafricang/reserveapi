import { Router } from 'express'
import {
  checkAvailability,
  initiateCashBooking,
  verifyAndConfirmBooking,
  createComplimentaryBooking,
  createPointsBooking,
  rescheduleBooking,
  verifyIkoyiMembership,
  getBooking,
} from '../controllers/booking.controller'
import { requireAuth } from '../middleware/auth'



const router = Router()

// Public — check availability without login
router.get('/availability', checkAvailability)
router.post('/ikoyi/verify', verifyIkoyiMembership)

// Protected — all booking actions require auth
router.post('/cash', requireAuth, initiateCashBooking)
router.post('/verify', requireAuth, verifyAndConfirmBooking)
router.post('/complimentary', requireAuth, createComplimentaryBooking)
router.post('/points', requireAuth, createPointsBooking)
router.get('/:bookingId', requireAuth, getBooking)
router.patch('/:bookingId/reschedule', requireAuth, rescheduleBooking)

export default router