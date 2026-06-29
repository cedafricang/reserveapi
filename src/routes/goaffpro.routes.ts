import { Router } from 'express'
import {
  handleReferralConverted,
  handleCommissionApproved,
} from '../controllers/goaffpro.controller'

const router = Router()

router.post('/referral-converted', handleReferralConverted)
router.post('/commission-approved', handleCommissionApproved)

export default router