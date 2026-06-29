export interface Customer {
  id: string
  email: string
  first_name: string
  last_name: string
  phone: string | null
  password_hash: string | null
  google_id: string | null
  shopify_customer_id: string | null
  tier: 'reserve-member' | 'silver' | 'gold' | 'platinum'
  points_balance: number
  annual_spend: number
  complimentary_sessions_used_this_year: number
  referral_code: string
  referred_by: string | null
  last_active_at: Date
  email_verified: boolean
  email_verification_token: string | null
  password_reset_token: string | null
  password_reset_expires: Date | null
  created_at: Date
  updated_at: Date
}

export interface JwtPayload {
  customerId: string
  email: string
  tier: Customer['tier']
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

export interface ApiResponse<T = null> {
  success: boolean
  message: string
  data?: T
  error?: string
}