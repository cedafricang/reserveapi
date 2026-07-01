import { Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import { query } from '../db'
import { generateTokens, verifyRefreshToken } from '../utils/jwt'
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
} from '../utils/email'
import { ApiResponse, Customer } from '../types'
import { AuthRequest } from '../middleware/auth'

// ── helpers ──────────────────────────────────────────────────
const generateReferralCode = (firstName: string): string => {
  const clean = firstName.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6)
  const suffix = Math.floor(1000 + Math.random() * 9000)
  return `${clean}${suffix}`
}

const sanitize = (customer: Customer) => ({
  id: customer.id,
  email: customer.email,
  firstName: customer.first_name,
  lastName: customer.last_name,
  phone: customer.phone,
  tier: customer.tier,
  pointsBalance: Number(customer.points_balance),
  annualSpend: Number(customer.annual_spend),
  referralCode: customer.referral_code,
  emailVerified: customer.email_verified,
  createdAt: customer.created_at,
})

// ── REGISTER ─────────────────────────────────────────────────
export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { firstName, lastName, email, phone, password, referralCode } = req.body

    // Validate required fields
    if (!firstName || !lastName || !email || !password) {
      res.status(400).json({
        success: false,
        message: 'First name, last name, email, and password are required.',
      })
      return
    }

    if (password.length < 8) {
      res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters.',
      })
      return
    }

    const emailLower = email.toLowerCase().trim()

    // Check if email already exists
    const existing = await query(
      'SELECT id FROM customers WHERE email = $1',
      [emailLower]
    )
   if (existing.rows.length > 0) {
  const existingCustomer = existing.rows[0]
  
  // If account exists but has no password (created by Shopify webhook)
  // allow them to set a password and activate their account
  if (!existingCustomer.password_hash) {
    const passwordHash = await bcrypt.hash(password, 12)
    const myReferralCode = existingCustomer.referral_code || generateReferralCode(firstName)
    
    await query(
      `UPDATE customers
       SET first_name = $1,
           last_name = $2,
           phone = $3,
           password_hash = $4,
           email_verified = true,
           updated_at = NOW()
       WHERE id = $5`,
      [
        firstName.trim(),
        lastName.trim(),
        phone?.trim() || null,
        passwordHash,
        existingCustomer.id,
      ]
    )

    const updatedCustomer = await query(
      'SELECT * FROM customers WHERE id = $1',
      [existingCustomer.id]
    )

    const tokens = generateTokens({
      customerId: existingCustomer.id,
      email: existingCustomer.email,
      tier: existingCustomer.tier,
    })

    // Send welcome email
    await sendWelcomeEmail(
      existingCustomer.email,
      firstName,
      existingCustomer.referral_code
    )

    res.status(200).json({
      success: true,
      message: 'Account activated. Your Soundhous purchase history and points are ready.',
      data: {
        customer: sanitize(updatedCustomer.rows[0]),
        ...tokens,
      },
    })
    return
  }

  // Account exists with a password — tell them to sign in
  res.status(409).json({
    success: false,
    message: 'An account with this email already exists. Sign in instead.',
  })
  return
}

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12)

    // Generate tokens
    const customerId = uuidv4()
    const myReferralCode = generateReferralCode(firstName)
    const verificationToken = uuidv4()

    // Check if referred by someone
    let referredById: string | null = null
    if (referralCode) {
      const referrer = await query(
        'SELECT id FROM customers WHERE referral_code = $1',
        [referralCode.toUpperCase()]
      )
      if (referrer.rows.length > 0) {
        referredById = referrer.rows[0].id
      }
    }

    // Insert customer
    const result = await query(
      `INSERT INTO customers (
        id, email, first_name, last_name, phone,
        password_hash, tier, points_balance, annual_spend,
        complimentary_sessions_used_this_year,
        referral_code, referred_by,
        email_verified, email_verification_token,
        last_active_at, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, 'reserve-member', 0, 0,
        0,
        $7, $8,
        false, $9,
        NOW(), NOW(), NOW()
      ) RETURNING *`,
      [
        customerId,
        emailLower,
        firstName.trim(),
        lastName.trim(),
        phone?.trim() || null,
        passwordHash,
        myReferralCode,
        referredById,
        verificationToken,
      ]
    )

    const customer: Customer = result.rows[0]

    // Send verification email
    await sendVerificationEmail(emailLower, firstName, verificationToken)

    // Generate JWT tokens
    const tokens = generateTokens({
      customerId: customer.id,
      email: customer.email,
      tier: customer.tier,
    })

    res.status(201).json({
      success: true,
      message: 'Account created. Please check your email to verify your address.',
      data: {
        customer: sanitize(customer),
        ...tokens,
      },
    } )
  } catch (err) {
    console.error('Register error:', err)
    res.status(500).json({
      success: false,
      message: 'Something went wrong. Please try again.',
    })
  }
}

// ── LOGIN ────────────────────────────────────────────────────
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      res.status(400).json({
        success: false,
        message: 'Email and password are required.',
      })
      return
    }

    const emailLower = email.toLowerCase().trim()

    // Find customer
    const result = await query(
      'SELECT * FROM customers WHERE email = $1',
      [emailLower]
    )

    if (result.rows.length === 0) {
      res.status(401).json({
        success: false,
        message: 'No account found with that email. Check the details and try again.',
      })
      return
    }

    const customer: Customer = result.rows[0]

    // Check if signed up with Google (no password)
    if (!customer.password_hash) {
  res.status(401).json({
    success: false,
    message: 'An account exists for this email but no password has been set. Please sign up to create your password — your points and purchase history are already in your account.',
    code: 'NO_PASSWORD',
  })
  return
}

    // Verify password
    const passwordMatch = await bcrypt.compare(password, customer.password_hash)
    if (!passwordMatch) {
      res.status(401).json({
        success: false,
        message: 'Incorrect password. Try again or reset your password.',
      })
      return
    }
    // Block unverified accounts (except those auto-verified via Shopify)
if (!customer.email_verified) {
  res.status(403).json({
    success: false,
    message: 'Please verify your email before signing in. Check your inbox for the verification link.',
    code: 'EMAIL_NOT_VERIFIED',
  })
  return
}

    // Update last active
    await query(
      'UPDATE customers SET last_active_at = NOW(), updated_at = NOW() WHERE id = $1',
      [customer.id]
    )

    // Generate tokens
    const tokens = generateTokens({
      customerId: customer.id,
      email: customer.email,
      tier: customer.tier,
    })

    res.status(200).json({
      success: true,
      message: 'Signed in successfully.',
      data: {
        customer: sanitize(customer),
        ...tokens,
      },
    } )
  } catch (err) {
    console.error('Login error:', err)
    res.status(500).json({
      success: false,
      message: 'Something went wrong. Please try again.',
    })
  }
}

// ── VERIFY EMAIL ─────────────────────────────────────────────
export const verifyEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.body

    if (!token) {
      res.status(400).json({ success: false, message: 'Verification token is required.' })
      return
    }

    const result = await query(
      'SELECT * FROM customers WHERE email_verification_token = $1',
      [token]
    )

    if (result.rows.length === 0) {
      res.status(400).json({
        success: false,
        message: 'Invalid or expired verification link.',
      })
      return
    }

    const customer: Customer = result.rows[0]

    if (customer.email_verified) {
      res.status(200).json({
        success: true,
        message: 'Email already verified. You can sign in.',
      })
      return
    }

    // Mark as verified and clear token
    await query(
      `UPDATE customers
       SET email_verified = true,
           email_verification_token = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [customer.id]
    )

    // Send welcome email with referral code
    await sendWelcomeEmail(
      customer.email,
      customer.first_name,
      customer.referral_code
    )

    // Award referral points to the person who referred them
    if (customer.referred_by) {
      await query(
        `UPDATE customers
         SET points_balance = points_balance + 50,
             updated_at = NOW()
         WHERE id = $1`,
        [customer.referred_by]
      )

      await query(
        `INSERT INTO points_transactions (
          id, customer_id, type, points, description, created_at
        ) VALUES ($1, $2, 'earn-referral-reserve', 50, $3, NOW())`,
        [
          uuidv4(),
          customer.referred_by,
          `Referral: ${customer.first_name} ${customer.last_name} joined Reserve`,
        ]
      )
    }

    const tokens = generateTokens({
      customerId: customer.id,
      email: customer.email,
      tier: customer.tier,
    })

    res.status(200).json({
      success: true,
      message: 'Email verified. Welcome to Reserve.',
      data: { ...tokens },
    })
  } catch (err) {
    console.error('Verify email error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

// ── FORGOT PASSWORD ──────────────────────────────────────────
export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body

    if (!email) {
      res.status(400).json({ success: false, message: 'Email is required.' })
      return
    }

    const emailLower = email.toLowerCase().trim()
    const result = await query(
      'SELECT * FROM customers WHERE email = $1',
      [emailLower]
    )

    // Always return success to prevent email enumeration
    if (result.rows.length === 0) {
      res.status(200).json({
        success: true,
        message: 'If an account exists with that email, a reset link has been sent.',
      })
      return
    }

    const customer: Customer = result.rows[0]
    const resetToken = uuidv4()
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    await query(
      `UPDATE customers
       SET password_reset_token = $1,
           password_reset_expires = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [resetToken, resetExpires, customer.id]
    )

    await sendPasswordResetEmail(customer.email, customer.first_name, resetToken)

    res.status(200).json({
      success: true,
      message: 'If an account exists with that email, a reset link has been sent.',
    })
  } catch (err) {
    console.error('Forgot password error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

// ── RESET PASSWORD ───────────────────────────────────────────
export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, password } = req.body

    if (!token || !password) {
      res.status(400).json({ success: false, message: 'Token and new password are required.' })
      return
    }

    if (password.length < 8) {
      res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' })
      return
    }

    const result = await query(
      `SELECT * FROM customers
       WHERE password_reset_token = $1
       AND password_reset_expires > NOW()`,
      [token]
    )

    if (result.rows.length === 0) {
      res.status(400).json({
        success: false,
        message: 'Reset link is invalid or has expired. Request a new one.',
      })
      return
    }

    const customer: Customer = result.rows[0]
    const passwordHash = await bcrypt.hash(password, 12)

    await query(
      `UPDATE customers
       SET password_hash = $1,
           password_reset_token = NULL,
           password_reset_expires = NULL,
           updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, customer.id]
    )

    res.status(200).json({
      success: true,
      message: 'Password updated. You can now sign in with your new password.',
    })
  } catch (err) {
    console.error('Reset password error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

// ── REFRESH TOKEN ────────────────────────────────────────────
export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken: token } = req.body

    if (!token) {
      res.status(400).json({ success: false, message: 'Refresh token is required.' })
      return
    }

    const payload = verifyRefreshToken(token)

    // Verify customer still exists
    const result = await query(
      'SELECT * FROM customers WHERE id = $1',
      [payload.customerId]
    )

    if (result.rows.length === 0) {
      res.status(401).json({ success: false, message: 'Account not found.' })
      return
    }

    const customer: Customer = result.rows[0]
    const tokens = generateTokens({
      customerId: customer.id,
      email: customer.email,
      tier: customer.tier,
    })

    res.status(200).json({
      success: true,
      message: 'Tokens refreshed.',
      data: { ...tokens },
    })
  } catch {
    res.status(401).json({
      success: false,
      message: 'Invalid or expired refresh token. Please sign in again.',
    })
  }
}

// ── GET ME ───────────────────────────────────────────────────
export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await query(
      'SELECT * FROM customers WHERE id = $1',
      [req.customer?.customerId]
    )

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Account not found.' })
      return
    }

    res.status(200).json({
      success: true,
      message: 'Customer retrieved.',
      data: { customer: sanitize(result.rows[0]) },
    })
  } catch (err) {
    console.error('Get me error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}