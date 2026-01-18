import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get available rides
router.get('/available', authenticateToken, (req, res) => {
  try {
    const rides = db.prepare(`
      SELECT r.*, u.name as driver_name, u.rating as driver_rating, u.total_rides as driver_total_rides
      FROM rides r
      JOIN users u ON r.driver_id = u.id
      WHERE r.status = 'available' AND r.available_seats > 0 AND r.pickup_time > datetime('now')
      ORDER BY r.pickup_time ASC
    `).all();

    const ridesWithDriver = rides.map(ride => ({
      ...ride,
      driver: { id: ride.driver_id, name: ride.driver_name, rating: ride.driver_rating, total_rides: ride.driver_total_rides }
    }));

    res.json(ridesWithDriver);
  } catch (error) {
    console.error('Get available rides error:', error);
    res.status(500).json({ message: 'Failed to get rides' });
  }
});

// Search rides
router.get('/search', authenticateToken, (req, res) => {
  try {
    const { pickup_location, drop_location, vehicle_type, seats_needed } = req.query;
    
    let query = `
      SELECT r.*, u.name as driver_name, u.rating as driver_rating
      FROM rides r
      JOIN users u ON r.driver_id = u.id
      WHERE r.status = 'available' AND r.pickup_time > datetime('now')
    `;
    const params = [];

    if (pickup_location) {
      query += ' AND r.pickup_address LIKE ?';
      params.push(`%${pickup_location}%`);
    }
    if (drop_location) {
      query += ' AND r.drop_address LIKE ?';
      params.push(`%${drop_location}%`);
    }
    if (vehicle_type && vehicle_type !== 'all') {
      query += ' AND r.vehicle_type = ?';
      params.push(vehicle_type);
    }
    if (seats_needed) {
      query += ' AND r.available_seats >= ?';
      params.push(parseInt(seats_needed));
    }

    query += ' ORDER BY r.pickup_time ASC';

    const rides = db.prepare(query).all(...params);
    res.json(rides.map(ride => ({
      ...ride,
      driver: { id: ride.driver_id, name: ride.driver_name, rating: ride.driver_rating }
    })));
  } catch (error) {
    console.error('Search rides error:', error);
    res.status(500).json({ message: 'Failed to search rides' });
  }
});

// Get ride by ID
router.get('/:id', authenticateToken, (req, res) => {
  try {
    const ride = db.prepare(`
      SELECT r.*, u.name as driver_name, u.rating as driver_rating
      FROM rides r
      JOIN users u ON r.driver_id = u.id
      WHERE r.id = ?
    `).get(req.params.id);

    if (!ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }

    res.json({
      ...ride,
      driver: { id: ride.driver_id, name: ride.driver_name, rating: ride.driver_rating }
    });
  } catch (error) {
    console.error('Get ride error:', error);
    res.status(500).json({ message: 'Failed to get ride' });
  }
});

// Create ride
router.post('/', authenticateToken, (req, res) => {
  try {
    const { pickup_address, drop_address, pickup_time, total_seats, available_seats, vehicle_type, price_per_seat, description, pickup_latitude, pickup_longitude, drop_latitude, drop_longitude } = req.body;

    if (!pickup_address || !drop_address || !pickup_time || !total_seats || !vehicle_type || !price_per_seat) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const rideId = uuidv4();
    db.prepare(`
      INSERT INTO rides (id, driver_id, pickup_address, drop_address, pickup_time, total_seats, available_seats, vehicle_type, price_per_seat, description, pickup_latitude, pickup_longitude, drop_latitude, drop_longitude)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(rideId, req.user.id, pickup_address, drop_address, pickup_time, total_seats, available_seats || total_seats, vehicle_type, price_per_seat, description || null, pickup_latitude || null, pickup_longitude || null, drop_latitude || null, drop_longitude || null);

    const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId);
    res.status(201).json(ride);
  } catch (error) {
    console.error('Create ride error:', error);
    res.status(500).json({ message: 'Failed to create ride' });
  }
});

// Get my published rides
router.get('/my/published', authenticateToken, (req, res) => {
  try {
    const rides = db.prepare('SELECT * FROM rides WHERE driver_id = ? ORDER BY created_at DESC').all(req.user.id);
    res.json(rides);
  } catch (error) {
    console.error('Get my rides error:', error);
    res.status(500).json({ message: 'Failed to get rides' });
  }
});

// Update ride status
router.patch('/:id/status', authenticateToken, (req, res) => {
  try {
    const { status, cancellation_reason } = req.body;
    const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(req.params.id);

    if (!ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }
    if (ride.driver_id !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // If cancelling, notify all confirmed passengers
    if (status === 'cancelled') {
      try {
        const bookings = db.prepare(`
          SELECT b.*, u.name as passenger_name 
          FROM ride_bookings b 
          JOIN users u ON b.passenger_id = u.id 
          WHERE b.ride_id = ? AND b.booking_status = 'confirmed'
        `).all(req.params.id);

        const driver = db.prepare('SELECT name FROM users WHERE id = ?').get(ride.driver_id);
        const pickupDate = new Date(ride.pickup_time);
        const formattedDate = pickupDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        const formattedTime = pickupDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

        for (const booking of bookings) {
          let messageText = `🚫 Ride Cancelled\n\n${driver?.name || 'The driver'} has cancelled the ride you booked.\n\n📍 Route: ${ride.pickup_address} → ${ride.drop_address}\n📅 Date: ${formattedDate} at ${formattedTime}\n🪑 Your seats: ${booking.seats_booked}\n💰 Refund: ₹${booking.total_price}`;
          if (cancellation_reason) {
            messageText += `\n\nReason: ${cancellation_reason}`;
          }
          messageText += `\n\nWe apologize for the inconvenience. Please search for alternative rides.`;

          const messageId = uuidv4();
          db.prepare(`
            INSERT INTO ride_messages (id, ride_id, sender_id, receiver_id, message, message_type)
            VALUES (?, ?, ?, ?, ?, 'text')
          `).run(messageId, ride.id, ride.driver_id, booking.passenger_id, messageText);

          // Also cancel the booking
          db.prepare('UPDATE ride_bookings SET booking_status = ? WHERE id = ?').run('cancelled', booking.id);
        }
      } catch (msgError) {
        console.warn('Failed to send ride cancellation notifications:', msgError);
      }
    }

    db.prepare('UPDATE rides SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, req.params.id);
    const updated = db.prepare('SELECT * FROM rides WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error) {
    console.error('Update ride status error:', error);
    res.status(500).json({ message: 'Failed to update ride' });
  }
});

// Delete ride
router.delete('/:id', authenticateToken, (req, res) => {
  try {
    const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(req.params.id);

    if (!ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }
    if (ride.driver_id !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    db.prepare('DELETE FROM rides WHERE id = ?').run(req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error('Delete ride error:', error);
    res.status(500).json({ message: 'Failed to delete ride' });
  }
});

export default router;
