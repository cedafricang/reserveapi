import { Router } from 'express'
import { handleAffiliateOrderCreated } from '../controllers/goaffpro.controller'

const router = Router()

router.post('/order-created', handleAffiliateOrderCreated)

// Keep old route as fallback in case GoAffPro retries
router.post('/commission-approved', handleAffiliateOrderCreated)
router.post('/referral-converted', handleAffiliateOrderCreated)

export default router