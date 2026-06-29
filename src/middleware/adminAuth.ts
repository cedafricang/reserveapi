import { Response, NextFunction } from 'express'
import { AuthRequest } from './auth'
import { query } from '../db'

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase())

export const requireAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.customer) {
      res.status(401).json({ success: false, message: 'Authentication required.' })
      return
    }

    const email = req.customer.email.toLowerCase()

    if (!ADMIN_EMAILS.includes(email)) {
      res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.',
      })
      return
    }

    next()
  } catch (err) {
    console.error('Admin auth error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}