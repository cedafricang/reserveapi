import { Router } from 'express'
import { getPublicClubs, getClubBySlug, claimMembership } from '../controllers/club.controller'

const router = Router()

router.get('/', getPublicClubs)
router.get('/:slug', getClubBySlug)
router.post('/:slug/claim', claimMembership)

export default router