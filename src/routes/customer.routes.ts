import { Router } from 'express'
import {
  getProfile,
  updateProfile,
  getPointsHistory,
  getBookingHistory,
  getReferralInfo,
} from '../controllers/customer.controller'
import { requireAuth } from '../middleware/auth'

const router = Router()

// All customer routes require authentication
router.use(requireAuth)

router.get('/profile', getProfile)
router.patch('/profile', updateProfile)
router.get('/points', getPointsHistory)
router.get('/bookings', getBookingHistory)
router.get('/referral', getReferralInfo)

export default router