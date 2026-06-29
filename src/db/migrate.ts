import { readFileSync } from 'fs'
import { join } from 'path'
import pool from './index'
import dotenv from 'dotenv'

dotenv.config()

const runMigrations = async () => {
  const client = await pool.connect()
  try {
    console.log('Running database migrations...')
    const sql = readFileSync(
      join(__dirname, 'migrations/001_create_tables.sql'),
      'utf8'
    )
    await client.query(sql)
    console.log('✓ All tables created successfully.')
    console.log('✓ Ikoyi Club, Polo Club, MECO Club seeded.')
  } catch (err) {
    console.error('Migration failed:', err)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

runMigrations()