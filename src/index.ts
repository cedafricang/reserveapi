import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import dotenv from 'dotenv'
import { generalRateLimit } from './middleware/rateLimit'
import authRoutes from './routes/auth.routes'
import customerRoutes from './routes/customer.routes'
import bookingRoutes from './routes/booking.routes'
import shopifyRoutes from './routes/shopify.routes'
import goaffproRoutes from './routes/goaffpro.routes'
import adminRoutes from './routes/admin.routes'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 8080

// ── Security middleware ───────────────────────────────────────
app.use(helmet())
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

// ── Raw body capture for webhook signature verification ───────
// Must come BEFORE express.json()
app.use('/api/webhooks', (req: Request, _res: Response, next: NextFunction) => {
  let data = Buffer.alloc(0)
  req.on('data', (chunk: Buffer) => {
    data = Buffer.concat([data, chunk])
  })
  req.on('end', () => {
    (req as Request & { rawBody: Buffer }).rawBody = data
    req.body = JSON.parse(data.toString() || '{}')
    next()
  })
})

// ── Body parsing (for all other routes) ──────────────────────
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// ── Rate limiting ─────────────────────────────────────────────
app.use(generalRateLimit)

// ── Health check ──────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'Soundhous Reserve API is running.',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  })
})

// ── Routes ────────────────────────────────────────────────────
app.use('/api/auth', authRoutes)
app.use('/api/customers', customerRoutes)
app.use('/api/bookings', bookingRoutes)
app.use('/api/webhooks/shopify', shopifyRoutes)
app.use('/api/webhooks/goaffpro', goaffproRoutes)
app.use('/api/admin', adminRoutes)

// ── 404 handler ───────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found.',
  })
})

// ── Global error handler ──────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err)
  res.status(500).json({
    success: false,
    message: 'An unexpected error occurred.',
  })
})

// ── Start server ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ┌─────────────────────────────────────────┐
  │                                         │
  │   Soundhous Reserve API                 │
  │   Running on port ${PORT}                  │
  │   Environment: ${process.env.NODE_ENV || 'development'}           │
  │                                         │
  └─────────────────────────────────────────┘
  `)
})

export default app