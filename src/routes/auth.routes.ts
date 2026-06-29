import { Router } from 'express'
import {
  register,
  login,
  verifyEmail,
  forgotPassword,
  resetPassword,
  refreshToken,
  getMe,
} from '../controllers/auth.controller'
import { requireAuth } from '../middleware/auth'
import { authRateLimit } from '../middleware/rateLimit'

const router = Router()

// Public routes
router.post('/register', authRateLimit, register)
router.post('/login', authRateLimit, login)
router.post('/verify-email', verifyEmail)
router.post('/forgot-password', authRateLimit, forgotPassword)
router.post('/reset-password', resetPassword)
router.post('/refresh', refreshToken)

// Protected routes
router.get('/me', requireAuth, getMe)

export default router