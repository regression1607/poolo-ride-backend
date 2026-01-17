import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Create booking
router.post('/', authenticateToken, (req, res) => {
  try {
    const { ride_id, seats_booked } = req.body;

    if (!ride_id || !seats_booked) {
      return res.status(400).json({ message: 'ride_id and seats_booked are required' });
    }

    const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(ride_id);
    if (!ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }
    if (ride.driver_id === req.user.id) {
      return res.status(400).json({ message: 'Cannot book your own ride' });
    }
    if (ride.available_seats < seats_booked) {
      return res.status(400).json({ message: 'Not enough seats available' });
    }

    const existingBooking = db.prepare('SELECT * FROM ride_bookings WHERE ride_id = ? AND passenger_id = ? AND booking_status != ?').get(ride_id, req.user.id, 'cancelled');
    if (existingBooking) {
      return res.status(400).json({ message: 'You already have a booking for this ride' });
    }

    const bookingId = uuidv4();
    const totalPrice = ride.price_per_seat * seats_booked;

    db.prepare(`
      INSERT INTO ride_bookings (id, ride_id, passenger_id, seats_booked, booking_status, total_price)
      VALUES (?, ?, ?, ?, 'confirmed', ?)
    `).run(bookingId, ride_id, req.user.id, seats_booked, totalPrice);

    db.prepare('UPDATE rides SET available_seats = available_seats - ? WHERE id = ?').run(seats_booked, ride_id);

    const booking = db.prepare('SELECT * FROM ride_bookings WHERE id = ?').get(bookingId);

    // Send notification message to driver
    try {
      const passenger = db.prepare('SELECT name FROM users WHERE id = ?').get(req.user.id);
      const pickupDate = new Date(ride.pickup_time);
      const formattedDate = pickupDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      const formattedTime = pickupDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
      
      const messageText = `🎉 New Booking!\n\n${passenger?.name || 'A passenger'} has booked ${seats_booked} seat(s) for your ride.\n\n📍 Route: ${ride.pickup_address} → ${ride.drop_address}\n📅 Date: ${formattedDate} at ${formattedTime}\n💰 Total: ₹${totalPrice}\n\nPlease confirm the pickup details with your passenger.`;
      
      const messageId = uuidv4();
      db.prepare(`
        INSERT INTO ride_messages (id, ride_id, sender_id, receiver_id, message, message_type)
        VALUES (?, ?, ?, ?, ?, 'text')
      `).run(messageId, ride_id, req.user.id, ride.driver_id, messageText);
    } catch (msgError) {
      console.warn('Failed to send booking notification:', msgError);
    }

    res.status(201).json(booking);
  } catch (error) {
    console.error('Create booking error:', error);
    res.status(500).json({ message: 'Failed to create booking' });
  }
});

// Get my bookings
router.get('/my', authenticateToken, (req, res) => {
  try {
    const bookings = db.prepare(`
      SELECT b.*, r.pickup_address, r.drop_address, r.pickup_time, r.vehicle_type, r.price_per_seat
      FROM ride_bookings b
      JOIN rides r ON b.ride_id = r.id
      WHERE b.passenger_id = ?
      ORDER BY b.booked_at DESC
    `).all(req.user.id);

    const bookingsWithRide = bookings.map(b => ({
      ...b,
      ride: { id: b.ride_id, pickup_address: b.pickup_address, drop_address: b.drop_address, pickup_time: b.pickup_time, vehicle_type: b.vehicle_type, price_per_seat: b.price_per_seat }
    }));

    res.json(bookingsWithRide);
  } catch (error) {
    console.error('Get my bookings error:', error);
    res.status(500).json({ message: 'Failed to get bookings' });
  }
});

// Get bookings for a ride
router.get('/ride/:rideId', authenticateToken, (req, res) => {
  try {
    const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(req.params.rideId);
    if (!ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }
    if (ride.driver_id !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const bookings = db.prepare(`
      SELECT b.*, u.name as passenger_name, u.rating as passenger_rating
      FROM ride_bookings b
      JOIN users u ON b.passenger_id = u.id
      WHERE b.ride_id = ?
      ORDER BY b.booked_at DESC
    `).all(req.params.rideId);

    res.json(bookings.map(b => ({
      ...b,
      passenger: { id: b.passenger_id, name: b.passenger_name, rating: b.passenger_rating }
    })));
  } catch (error) {
    console.error('Get ride bookings error:', error);
    res.status(500).json({ message: 'Failed to get bookings' });
  }
});

// Cancel booking
router.patch('/:id/cancel', authenticateToken, (req, res) => {
  try {
    const booking = db.prepare('SELECT * FROM ride_bookings WHERE id = ?').get(req.params.id);
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }
    if (booking.passenger_id !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (booking.booking_status === 'cancelled') {
      return res.status(400).json({ message: 'Booking already cancelled' });
    }

    db.prepare('UPDATE ride_bookings SET booking_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('cancelled', req.params.id);
    db.prepare('UPDATE rides SET available_seats = available_seats + ? WHERE id = ?').run(booking.seats_booked, booking.ride_id);

    // Send cancellation notification to driver
    try {
      const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(booking.ride_id);
      const passenger = db.prepare('SELECT name FROM users WHERE id = ?').get(req.user.id);
      const pickupDate = new Date(ride.pickup_time);
      const formattedDate = pickupDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      const formattedTime = pickupDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
      const newAvailableSeats = ride.available_seats + booking.seats_booked;
      
      const messageText = `🚫 Booking Cancelled\n\n${passenger?.name || 'A passenger'} has cancelled their booking.\n\n📍 Route: ${ride.pickup_address} → ${ride.drop_address}\n📅 Date: ${formattedDate} at ${formattedTime}\n🪑 Seats cancelled: ${booking.seats_booked}\n💰 Refund: ₹${booking.total_price}\n\nYour ride now has ${newAvailableSeats} seats available.`;
      
      const messageId = uuidv4();
      db.prepare(`
        INSERT INTO ride_messages (id, ride_id, sender_id, receiver_id, message, message_type)
        VALUES (?, ?, ?, ?, ?, 'text')
      `).run(messageId, booking.ride_id, req.user.id, ride.driver_id, messageText);
    } catch (msgError) {
      console.warn('Failed to send cancellation notification:', msgError);
    }

    const updated = db.prepare('SELECT * FROM ride_bookings WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error) {
    console.error('Cancel booking error:', error);
    res.status(500).json({ message: 'Failed to cancel booking' });
  }
});

export default router;
