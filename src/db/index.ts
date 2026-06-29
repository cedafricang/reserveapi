import { Pool } from 'pg'
import dotenv from 'dotenv'

dotenv.config()

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required')
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : { rejectUnauthorized: false },
  max: 10,
  min: 2,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
  allowExitOnIdle: false,
})

// Keep connections alive
const keepAlive = () => {
  pool.query('SELECT 1').catch(err => {
    console.error('Keep-alive query failed:', err.message)
  })
}

setInterval(keepAlive, 10000)

pool.on('error', (err) => {
  console.error('Unexpected database error:', err.message)
})

pool.on('connect', () => {
  if (process.env.NODE_ENV === 'development') {
    console.log('New database connection established')
  }
})

export const query = async (text: string, params?: unknown[]) => {
  const start = Date.now()
  try {
    const res = await pool.query(text, params)
    const duration = Date.now() - start
    if (process.env.NODE_ENV === 'development') {
      console.log('Query executed:', { text: text.slice(0, 60), duration: `${duration}ms`, rows: res.rowCount })
    }
    return res
  } catch (err) {
    console.error('Query error:', { text: text.slice(0, 60), error: err })
    throw err
  }
}

export const getClient = () => pool.connect()

export default pool