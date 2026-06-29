import { Request, Response, NextFunction } from 'express'
import { verifyAccessToken } from '../utils/jwt'
import { JwtPayload } from '../types'

export interface AuthRequest extends Request {
  customer?: JwtPayload
}

export const requireAuth = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        message: 'Authentication required. Please sign in.',
      })
      return
    }

    const token = authHeader.split(' ')[1]
    const payload = verifyAccessToken(token)
    req.customer = payload
    next()
  } catch {
    res.status(401).json({
      success: false,
      message: 'Session expired or invalid. Please sign in again.',
    })
  }
}