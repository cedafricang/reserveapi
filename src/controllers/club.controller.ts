import { Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { query } from '../db'
import bcrypt from 'bcryptjs'

export const getPublicClubs = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await query(
      'SELECT id, name, description, slug FROM clubs WHERE active = true ORDER BY name ASC'
    )
    res.status(200).json({ success: true, data: { clubs: result.rows } })
  } catch (err) {
    console.error('Get public clubs error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

export const getClubBySlug = async (req: Request, res: Response): Promise<void> => {
  try {
    const { slug } = req.params
    const result = await query(
      'SELECT id, name, description, slug FROM clubs WHERE slug = $1 AND active = true',
      [slug]
    )
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Club not found.' })
      return
    }
    res.status(200).json({ success: true, data: { club: result.rows[0] } })
  } catch (err) {
    console.error('Get club error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}

export const claimMembership = async (req: Request, res: Response): Promise<void> => {
  try {
    const { slug } = req.params
    const { membershipCode, firstName, lastName, email, phone } = req.body

    if (!membershipCode || !firstName || !lastName || !email) {
      res.status(400).json({ success: false, message: 'Membership code, name, and email are required.' })
      return
    }

    const emailLower = email.toLowerCase().trim()
    const code = membershipCode.trim().toUpperCase()

    // Get club
    const clubResult = await query(
      'SELECT id, name FROM clubs WHERE slug = $1 AND active = true',
      [slug]
    )
    if (clubResult.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Club not found.' })
      return
    }
    const club = clubResult.rows[0]

    // Check membership code exists and belongs to this club
    const codeResult = await query(
      'SELECT * FROM club_membership_ids WHERE club_id = $1 AND membership_code = $2',
      [club.id, code]
    )
    if (codeResult.rows.length === 0) {
      res.status(404).json({ success: false, message: 'This membership code is not valid for this club.' })
      return
    }

    const membership = codeResult.rows[0]

    // Check if already claimed by someone else
    if (membership.claimed) {
      const claimedByResult = await query(
        'SELECT email FROM customers WHERE id = $1',
        [membership.claimed_by_customer_id]
      )
      const claimedByEmail = claimedByResult.rows[0]?.email
      if (claimedByEmail && claimedByEmail !== emailLower) {
        res.status(409).json({ success: false, message: 'This membership code has already been claimed.' })
        return
      }
      // Same email trying to claim again — just return success
      if (claimedByEmail === emailLower) {
        res.status(200).json({
          success: true,
          message: 'This membership is already linked to your account.',
          data: { alreadyClaimed: true },
        })
        return
      }
    }

    // Check if customer already exists
    const existingCustomer = await query(
      'SELECT * FROM customers WHERE email = $1',
      [emailLower]
    )

    let customerId: string

    if (existingCustomer.rows.length > 0) {
      // Update existing customer with club membership
      customerId = existingCustomer.rows[0].id
      if (existingCustomer.rows[0].club_id) {
        res.status(409).json({ success: false, message: 'Your account is already linked to a club membership.' })
        return
      }
      await query(
        `UPDATE customers SET
          club_id = $1,
          club_membership_code = $2,
          club_first_visit_used = false,
          updated_at = NOW()
         WHERE id = $3`,
        [club.id, code, customerId]
      )
    } else {
      // Create new passwordless customer account
      customerId = uuidv4()
      const referralCode = `${firstName.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4)}${Math.floor(1000 + Math.random() * 9000)}`
      await query(
        `INSERT INTO customers (
          id, email, first_name, last_name, phone,
          password_hash, tier, points_balance, annual_spend,
          complimentary_sessions_used_this_year,
          referral_code, email_verified,
          club_id, club_membership_code, club_first_visit_used,
          last_active_at, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          NULL, 'reserve-member', 0, 0, 0,
          $6, false,
          $7, $8, false,
          NOW(), NOW(), NOW()
        )`,
        [customerId, emailLower, firstName.trim(), lastName.trim(), phone?.trim() || null, referralCode, club.id, code]
      )
    }

    // Mark membership code as claimed
    await query(
      `UPDATE club_membership_ids SET
        claimed = true,
        claimed_by_customer_id = $1,
        claimed_at = NOW()
       WHERE id = $2`,
      [customerId, membership.id]
    )

    res.status(200).json({
      success: true,
      message: `Welcome to Soundhous Reserve. Your ${club.name} membership has been verified. Sign up at bookings.soundhous.com to complete your account and start booking.`,
      data: {
        clubName: club.name,
        firstName: firstName.trim(),
        email: emailLower,
        isNewAccount: existingCustomer.rows.length === 0,
        benefits: {
          firstVisit: 'Complimentary session on your first booking',
          ongoing: '20% discount on all subsequent bookings',
        },
      },
    })
  } catch (err) {
    console.error('Claim membership error:', err)
    res.status(500).json({ success: false, message: 'Something went wrong.' })
  }
}