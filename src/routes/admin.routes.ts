import { Router } from 'express'
import {
  getOverview,
  getAllBookings,
  adminCreateBooking,
  adminCancelBooking,
  getAllCustomers,
  grantComplimentaryAccess,
  overrideTier,
  adjustPoints,
  getClubMembers,
  addClubMember,
  getReports,
  runAnnualReset,
  createOfflineCustomer,
  getAdminGuests,
  exportCSV,
} from '../controllers/admin.controller'
import { requireAuth } from '../middleware/auth'
import { requireAdmin } from '../middleware/adminAuth'
import {
  // ...existing imports...
  getBookingDetail,
} from '../controllers/admin.controller'


const router = Router()

// All admin routes require auth + admin role
router.use(requireAuth)
router.use(requireAdmin)
router.post('/customers/create-offline', requireAdmin, createOfflineCustomer)
router.get('/guests', requireAdmin, getAdminGuests)
router.get('/export', requireAdmin, exportCSV)

// Overview
router.get('/overview', getOverview)

// Bookings
router.get('/bookings', getAllBookings)
router.post('/bookings', adminCreateBooking)
router.patch('/bookings/:bookingId/cancel', adminCancelBooking)
router.get('/bookings/:bookingId', getBookingDetail)

// Customers
router.get('/customers', getAllCustomers)
router.post('/customers/:customerId/complimentary', grantComplimentaryAccess)
router.patch('/customers/:customerId/tier', overrideTier)
router.patch('/customers/:customerId/points', adjustPoints)

// Clubs
router.get('/clubs/:clubSlug/members', getClubMembers)
router.post('/clubs/:clubSlug/members', addClubMember)

// Reports
router.get('/reports', getReports)

// Annual reset — run on 1 January
router.post('/reset/annual', runAnnualReset)

export default router