import { Router } from 'express'
import { handleOrderPaid, handleCustomerCreated } from '../controllers/shopify.controller'

const router = Router()

// Shopify sends raw body — we need it for HMAC verification
// These routes do NOT use express.json() middleware
router.post('/order-paid', handleOrderPaid)
router.post('/customer-created', handleCustomerCreated)

export default router