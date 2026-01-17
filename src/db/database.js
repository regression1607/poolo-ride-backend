import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const dbPath = process.env.DATABASE_PATH || './data/poolo.db';
const dbDir = path.dirname(dbPath);

// Ensure data directory exists
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      phone_number TEXT,
      profile_picture TEXT,
      rating REAL DEFAULT 5.0,
      total_rides INTEGER DEFAULT 0,
      is_verified INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS rides (
      id TEXT PRIMARY KEY,
      driver_id TEXT NOT NULL,
      pickup_address TEXT NOT NULL,
      pickup_latitude REAL,
      pickup_longitude REAL,
      drop_address TEXT NOT NULL,
      drop_latitude REAL,
      drop_longitude REAL,
      pickup_time TEXT NOT NULL,
      expected_drop_time TEXT,
      total_seats INTEGER NOT NULL,
      available_seats INTEGER NOT NULL,
      vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ('bike', 'car', 'cab', 'suv')),
      price_per_seat REAL NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'available' CHECK (status IN ('available', 'active', 'completed', 'cancelled')),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (driver_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS ride_bookings (
      id TEXT PRIMARY KEY,
      ride_id TEXT NOT NULL,
      passenger_id TEXT NOT NULL,
      seats_booked INTEGER NOT NULL,
      booking_status TEXT DEFAULT 'pending' CHECK (booking_status IN ('pending', 'confirmed', 'cancelled', 'completed')),
      total_price REAL NOT NULL,
      booked_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ride_id) REFERENCES rides(id),
      FOREIGN KEY (passenger_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS ride_messages (
      id TEXT PRIMARY KEY,
      ride_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      receiver_id TEXT NOT NULL,
      message TEXT NOT NULL,
      message_type TEXT DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'location')),
      is_read INTEGER DEFAULT 0,
      sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ride_id) REFERENCES rides(id),
      FOREIGN KEY (sender_id) REFERENCES users(id),
      FOREIGN KEY (receiver_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides(driver_id);
    CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status);
    CREATE INDEX IF NOT EXISTS idx_bookings_ride ON ride_bookings(ride_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_passenger ON ride_bookings(passenger_id);
    CREATE INDEX IF NOT EXISTS idx_messages_ride ON ride_messages(ride_id);
  `);
  
  console.log('✅ Database initialized');
}

export default db;
