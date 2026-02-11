#!/usr/bin/env tsx

/**
 * PostgreSQL setup script
 * Creates user, database, and grants permissions
 * Only runs if DB_TYPE=postgres
 */

import 'dotenv/config';
import { Client } from 'pg';

// Default values
const DEFAULT_USER = 'atlas_user';
const DEFAULT_PASSWORD = 'atlas_password';
const DEFAULT_DB = 'atlas_documents';
const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = '5432';

async function main() {
  // Check if DB_TYPE is postgres
  if (process.env.DB_TYPE !== 'postgres') {
    process.exit(0);
  }

  console.log('🐘 PostgreSQL Setup for Atlas');
  console.log('==============================\n');

  // Parse target user/db from POSTGRES_URL
  let user = DEFAULT_USER;
  let password = DEFAULT_PASSWORD;
  let database = DEFAULT_DB;
  let host = DEFAULT_HOST;
  let port = DEFAULT_PORT;
  const schema = process.env.POSTGRES_SCHEMA || 'public';

  if (process.env.POSTGRES_URL) {
    const url = new URL(process.env.POSTGRES_URL);
    user = url.username || DEFAULT_USER;
    password = url.password || DEFAULT_PASSWORD;
    host = url.hostname || DEFAULT_HOST;
    port = url.port || DEFAULT_PORT;
    database = url.pathname.slice(1) || DEFAULT_DB;
  }

  // Parse superuser credentials (if provided for user creation)
  let setupUser = user;
  let setupPassword = password;
  let setupHost = host;
  let setupPort = port;
  const hasSuperuserUrl = !!process.env.POSTGRES_SUPERUSER_URL;

  if (hasSuperuserUrl && process.env.POSTGRES_SUPERUSER_URL) {
    const superUrl = new URL(process.env.POSTGRES_SUPERUSER_URL);
    setupUser = superUrl.username || user;
    setupPassword = superUrl.password || password;
    setupHost = superUrl.hostname || host;
    setupPort = superUrl.port || port;
  }

  console.log('Configuration:');
  console.log(`  Target User:     ${user}`);
  console.log(`  Target Password: ${'*'.repeat(password.length)}`);
  console.log(`  Database:        ${database}`);
  console.log(`  Schema:          ${schema}`);
  console.log(`  Host:            ${host}`);
  console.log(`  Port:            ${port}`);
  if (hasSuperuserUrl) {
    console.log(`  Setup User:      ${setupUser} (from POSTGRES_SUPERUSER_URL)`);
  }
  console.log('');

  console.log('📝 This script will:');
  let step = 1;
  if (hasSuperuserUrl && user !== setupUser) {
    console.log(`   ${step++}. Create user '${user}' (if not exists)`);
  }
  console.log(`   ${step++}. Create database '${database}' (if not exists)`);
  if (schema !== 'public') {
    console.log(`   ${step++}. Create schema '${schema}' (if not exists)`);
  }
  console.log(`   ${step++}. Grant all permissions to user`);
  console.log('');

  // Connect using setup credentials (superuser if provided, otherwise target user)
  let client: Client | null = null;

  try {
    client = new Client({
      host: setupHost,
      port: parseInt(setupPort),
      user: setupUser,
      password: setupPassword,
      database: 'template1', // Always exists
    });
    await client.connect();
    console.log(`✅ Connected as: ${setupUser}\n`);
  } catch (error: any) {
    console.error('❌ Could not connect to PostgreSQL');
    console.error(`   User: ${setupUser}`);
    console.error(`   Host: ${setupHost}:${setupPort}`);
    console.error(`   Error: ${error.message}\n`);
    console.error('💡 Check your POSTGRES_URL and ensure PostgreSQL is accessible');
    process.exit(1);
  }

  try {
    console.log('🔧 Setting up PostgreSQL...\n');

    // Create user only if POSTGRES_SUPERUSER_URL provided AND user != superuser
    if (hasSuperuserUrl && user !== setupUser) {
      console.log('📝 Checking user...');
      const userCheckResult = await client.query(
        `SELECT 1 FROM pg_user WHERE usename = $1`,
        [user]
      );

      if (userCheckResult.rows.length === 0) {
        console.log(`📝 Creating user '${user}'...`);
        await client.query(`CREATE USER ${user} WITH PASSWORD '${password}'`);
        console.log(`✅ User '${user}' created`);
      } else {
        console.log(`ℹ️  User '${user}' already exists (skipping creation)`);
      }
    } else if (!hasSuperuserUrl) {
      console.log(`ℹ️  Using existing user '${user}' (no POSTGRES_SUPERUSER_URL provided)`);
    }

    // Create database if not exists
    console.log('📝 Creating database...');
    const dbCheckResult = await client.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [database]
    );

    if (dbCheckResult.rows.length === 0) {
      await client.query(`CREATE DATABASE ${database} OWNER ${user}`);
      console.log(`✅ Database ${database} created`);
    } else {
      console.log(`ℹ️  Database ${database} already exists`);
    }

    // Grant permissions
    console.log('📝 Granting permissions...');
    await client.query(`GRANT ALL PRIVILEGES ON DATABASE ${database} TO ${user}`);

    // Connect to the target database to set up schema permissions
    await client.end();
    client = new Client({
      host: setupHost,
      port: parseInt(setupPort),
      user: setupUser,
      password: setupPassword,
      database,
    });
    await client.connect();

    // Create custom schema if specified (not 'public')
    if (schema !== 'public') {
      console.log(`📝 Creating schema '${schema}'...`);
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
      await client.query(`GRANT ALL ON SCHEMA ${schema} TO ${user}`);
      await client.query(`ALTER SCHEMA ${schema} OWNER TO ${user}`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT ALL ON TABLES TO ${user}`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT ALL ON SEQUENCES TO ${user}`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT ALL ON FUNCTIONS TO ${user}`);
      console.log(`✅ Schema '${schema}' created and configured`);
    } else {
      // Set up public schema permissions
      await client.query(`GRANT ALL ON SCHEMA public TO ${user}`);
      await client.query(`ALTER SCHEMA public OWNER TO ${user}`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${user}`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${user}`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO ${user}`);
    }

    console.log('\n✅ PostgreSQL setup complete!\n');
    console.log('📝 Your .env should have:');
    console.log(`   DB_TYPE=postgres`);
    console.log(`   POSTGRES_URL=postgresql://${user}:${password}@${host}:${port}/${database}`);
    if (schema !== 'public') {
      console.log(`   POSTGRES_SCHEMA=${schema}`);
    }
    console.log('');
    console.log('🚀 Now run: npm run import-db -- --replace-db=y --all\n');
  } catch (error: any) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  } finally {
    if (client) await client.end();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
