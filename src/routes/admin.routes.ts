import { Router } from 'express'
import {
  getOverview,
  getAllBookings,
  adminCreateBooking,
  adminCancelBooking,
  getAllCustomers,
  getBookingDetail,
  grantComplimentaryAccess,
  overrideTier,
  adjustPoints,
  getReports,
  runAnnualReset,
  createOfflineCustomer,
  getAdminGuests,
  exportCSV,
  createClub,
  getAllClubs,
  checkInTicket,
  getAllTickets,
  addMembershipIds,
  getMembershipIds,
  exportMembershipIds,
} from '../controllers/admin.controller'
import { requireAuth } from '../middleware/auth'
import { requireAdmin } from '../middleware/adminAuth'



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
// Clubs
router.post('/clubs', createClub)
router.get('/clubs', getAllClubs)
router.post('/clubs/:clubId/membership-ids', addMembershipIds)
router.get('/clubs/:clubId/membership-ids', getMembershipIds)
router.get('/clubs/:clubId/membership-ids/export', exportMembershipIds)

// Reports
router.get('/reports', getReports)

// Annual reset — run on 1 January
router.post('/reset/annual', runAnnualReset)

export default router