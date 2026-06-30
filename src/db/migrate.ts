import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import pool from './index'
import dotenv from 'dotenv'

dotenv.config()

const runMigrations = async () => {
  const client = await pool.connect()
  try {
    console.log('Running database migrations...')

    const migrationsDir = join(__dirname, 'migrations')
    const files = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort() // ensures 001_, 002_, etc run in order

    for (const file of files) {
      console.log(`Running migration: ${file}`)
      const sql = readFileSync(join(migrationsDir, file), 'utf8')
      await client.query(sql)
      console.log(`✓ ${file} applied.`)
    }

    console.log('✓ All migrations completed successfully.')
  } catch (err) {
    console.error('Migration failed:', err)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

runMigrations()