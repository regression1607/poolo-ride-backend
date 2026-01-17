import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { createClient } from '@supabase/supabase-js';

const app = express();

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// CORS configuration for Vercel serverless
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Handle preflight OPTIONS requests
app.options('*', cors());

app.use(express.json());

// Auth middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(403).json({ message: 'Invalid or expired token' });
  }
}

// Get user helper
async function getUser(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  return data;
}

// ============ AUTH ROUTES ============

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name, username, phone_number } = req.body;

    if (!email || !password || !name || !username) {
      return res.status(400).json({ message: 'Email, password, name, and username are required' });
    }

    // Check if user exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .or(`email.eq.${email},username.eq.${username}`)
      .maybeSingle();

    if (existingUser) {
      return res.status(400).json({ message: 'Email or username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();

    const { data: user, error } = await supabase
      .from('users')
      .insert({
        id: userId,
        email,
        password_hash: hashedPassword,
        name,
        username,
        phone_number: phone_number || null,
        total_rides: 0,
        is_verified: false,
        rating: 0
      })
      .select('id, email, name, username, phone_number, rating, total_rides, is_verified, created_at')
      .single();

    if (error) throw error;

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ user, token });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ message: 'Failed to register user' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    const { password_hash, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword, token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Failed to login' });
  }
});

// Get profile
app.get('/api/auth/profile', authenticateToken, async (req, res) => {
  const user = await getUser(req.userId);
  if (!user) return res.status(404).json({ message: 'User not found' });
  const { password_hash, ...userWithoutPassword } = user;
  res.json(userWithoutPassword);
});

// Update profile
app.put('/api/auth/profile', authenticateToken, async (req, res) => {
  try {
    const { name, phone_number } = req.body;

    const { data: user, error } = await supabase
      .from('users')
      .update({ name, phone_number })
      .eq('id', req.userId)
      .select('id, email, name, username, phone_number, rating, total_rides, is_verified, created_at')
      .single();

    if (error) throw error;
    res.json(user);
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Failed to update profile' });
  }
});

// ============ RIDES ROUTES ============

// Get available rides
app.get('/api/rides/available', authenticateToken, async (req, res) => {
  try {
    const { data: rides, error } = await supabase
      .from('rides')
      .select('*, driver:users!rides_driver_id_fkey(id, name, rating, total_rides)')
      .eq('status', 'available')
      .gt('available_seats', 0)
      .gt('pickup_time', new Date().toISOString())
      .order('pickup_time', { ascending: true });

    if (error) throw error;
    res.json(rides || []);
  } catch (error) {
    console.error('Get available rides error:', error);
    res.status(500).json({ message: 'Failed to get rides' });
  }
});

// Search rides
app.get('/api/rides/search', authenticateToken, async (req, res) => {
  try {
    const { pickup_location, drop_location, vehicle_type, seats_needed } = req.query;

    let query = supabase
      .from('rides')
      .select('*, driver:users!rides_driver_id_fkey(id, name, rating)')
      .eq('status', 'available')
      .gt('pickup_time', new Date().toISOString());

    if (pickup_location) {
      query = query.ilike('pickup_address', `%${pickup_location}%`);
    }
    if (drop_location) {
      query = query.ilike('drop_address', `%${drop_location}%`);
    }
    if (vehicle_type && vehicle_type !== 'all') {
      query = query.eq('vehicle_type', vehicle_type);
    }
    if (seats_needed) {
      query = query.gte('available_seats', parseInt(seats_needed));
    }

    const { data: rides, error } = await query.order('pickup_time', { ascending: true });

    if (error) throw error;
    res.json(rides || []);
  } catch (error) {
    console.error('Search rides error:', error);
    res.status(500).json({ message: 'Failed to search rides' });
  }
});

// Get my published rides
app.get('/api/rides/my/published', authenticateToken, async (req, res) => {
  try {
    const { data: rides, error } = await supabase
      .from('rides')
      .select('*')
      .eq('driver_id', req.userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(rides || []);
  } catch (error) {
    console.error('Get my rides error:', error);
    res.status(500).json({ message: 'Failed to get rides' });
  }
});

// Get ride by ID
app.get('/api/rides/:id', authenticateToken, async (req, res) => {
  try {
    const { data: ride, error } = await supabase
      .from('rides')
      .select('*, driver:users!rides_driver_id_fkey(id, name, rating)')
      .eq('id', req.params.id)
      .single();

    if (error || !ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }
    res.json(ride);
  } catch (error) {
    console.error('Get ride error:', error);
    res.status(500).json({ message: 'Failed to get ride' });
  }
});

// Create ride
app.post('/api/rides', authenticateToken, async (req, res) => {
  try {
    const { pickup_address, drop_address, pickup_time, total_seats, available_seats, vehicle_type, price_per_seat, description } = req.body;

    if (!pickup_address || !drop_address || !pickup_time || !total_seats || !vehicle_type || !price_per_seat) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const { data: ride, error } = await supabase
      .from('rides')
      .insert({
        driver_id: req.userId,
        pickup_address,
        drop_address,
        pickup_time,
        total_seats,
        available_seats: available_seats || total_seats,
        vehicle_type,
        price_per_seat,
        description: description || null,
        status: 'available'
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(ride);
  } catch (error) {
    console.error('Create ride error:', error);
    res.status(500).json({ message: 'Failed to create ride' });
  }
});

// Update ride status
app.patch('/api/rides/:id/status', authenticateToken, async (req, res) => {
  try {
    const { status, cancellation_reason } = req.body;

    const { data: ride, error: fetchError } = await supabase
      .from('rides')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }
    if (ride.driver_id !== req.userId) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // If cancelling, notify passengers and cancel their bookings
    if (status === 'cancelled') {
      const { data: bookings } = await supabase
        .from('ride_bookings')
        .select('*, passenger:users!ride_bookings_passenger_id_fkey(name)')
        .eq('ride_id', req.params.id)
        .eq('booking_status', 'confirmed');

      if (bookings && bookings.length > 0) {
        const user = await getUser(req.userId);
        const pickupDate = new Date(ride.pickup_time);
        const formattedDate = pickupDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        const formattedTime = pickupDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

        for (const booking of bookings) {
          let messageText = `🚫 Ride Cancelled\n\n${user?.name || 'The driver'} has cancelled the ride you booked.\n\n📍 Route: ${ride.pickup_address} → ${ride.drop_address}\n📅 Date: ${formattedDate} at ${formattedTime}\n🪑 Your seats: ${booking.seats_booked}\n💰 Refund: ₹${booking.total_price}`;
          if (cancellation_reason) messageText += `\n\nReason: ${cancellation_reason}`;
          messageText += `\n\nWe apologize for the inconvenience.`;

          await supabase.from('ride_messages').insert({
            ride_id: ride.id,
            sender_id: ride.driver_id,
            receiver_id: booking.passenger_id,
            message: messageText,
            message_type: 'text'
          });

          await supabase
            .from('ride_bookings')
            .update({ booking_status: 'cancelled' })
            .eq('id', booking.id);
        }
      }
    }

    const { data: updated, error } = await supabase
      .from('rides')
      .update({ status })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(updated);
  } catch (error) {
    console.error('Update ride status error:', error);
    res.status(500).json({ message: 'Failed to update ride' });
  }
});

// Delete ride
app.delete('/api/rides/:id', authenticateToken, async (req, res) => {
  try {
    const { data: ride, error: fetchError } = await supabase
      .from('rides')
      .select('driver_id')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }
    if (ride.driver_id !== req.userId) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    await supabase.from('rides').delete().eq('id', req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error('Delete ride error:', error);
    res.status(500).json({ message: 'Failed to delete ride' });
  }
});

// ============ BOOKINGS ROUTES ============

// Create booking
app.post('/api/bookings', authenticateToken, async (req, res) => {
  try {
    const { ride_id, seats_booked } = req.body;

    if (!ride_id || !seats_booked) {
      return res.status(400).json({ message: 'ride_id and seats_booked are required' });
    }

    const { data: ride, error: rideError } = await supabase
      .from('rides')
      .select('*')
      .eq('id', ride_id)
      .single();

    if (rideError || !ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }
    if (ride.driver_id === req.userId) {
      return res.status(400).json({ message: 'Cannot book your own ride' });
    }
    if (ride.available_seats < seats_booked) {
      return res.status(400).json({ message: 'Not enough seats available' });
    }

    const { data: existingBooking } = await supabase
      .from('ride_bookings')
      .select('id')
      .eq('ride_id', ride_id)
      .eq('passenger_id', req.userId)
      .neq('booking_status', 'cancelled')
      .maybeSingle();

    if (existingBooking) {
      return res.status(400).json({ message: 'You already have a booking for this ride' });
    }

    const totalPrice = ride.price_per_seat * seats_booked;

    const { data: booking, error } = await supabase
      .from('ride_bookings')
      .insert({
        ride_id,
        passenger_id: req.userId,
        seats_booked,
        total_price: totalPrice,
        booking_status: 'confirmed'
      })
      .select()
      .single();

    if (error) throw error;

    // Update available seats
    await supabase
      .from('rides')
      .update({ available_seats: ride.available_seats - seats_booked })
      .eq('id', ride_id);

    // Send notification to driver
    const passenger = await getUser(req.userId);
    const pickupDate = new Date(ride.pickup_time);
    const formattedDate = pickupDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const formattedTime = pickupDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    const messageText = `🎉 New Booking!\n\n${passenger?.name || 'A passenger'} has booked ${seats_booked} seat(s) for your ride.\n\n📍 Route: ${ride.pickup_address} → ${ride.drop_address}\n📅 Date: ${formattedDate} at ${formattedTime}\n💰 Total: ₹${totalPrice}\n\nPlease confirm the pickup details with your passenger.`;

    await supabase.from('ride_messages').insert({
      ride_id,
      sender_id: req.userId,
      receiver_id: ride.driver_id,
      message: messageText,
      message_type: 'text'
    });

    res.status(201).json(booking);
  } catch (error) {
    console.error('Create booking error:', error);
    res.status(500).json({ message: 'Failed to create booking' });
  }
});

// Get my bookings
app.get('/api/bookings/my', authenticateToken, async (req, res) => {
  try {
    const { data: bookings, error } = await supabase
      .from('ride_bookings')
      .select('*, ride:rides(id, pickup_address, drop_address, pickup_time, vehicle_type, price_per_seat)')
      .eq('passenger_id', req.userId)
      .order('booked_at', { ascending: false });

    if (error) throw error;
    res.json(bookings || []);
  } catch (error) {
    console.error('Get my bookings error:', error);
    res.status(500).json({ message: 'Failed to get bookings' });
  }
});

// Get bookings for a ride
app.get('/api/bookings/ride/:rideId', authenticateToken, async (req, res) => {
  try {
    const { data: ride } = await supabase
      .from('rides')
      .select('driver_id')
      .eq('id', req.params.rideId)
      .single();

    if (!ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }
    if (ride.driver_id !== req.userId) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const { data: bookings, error } = await supabase
      .from('ride_bookings')
      .select('*, passenger:users!ride_bookings_passenger_id_fkey(id, name, rating)')
      .eq('ride_id', req.params.rideId)
      .order('booked_at', { ascending: false });

    if (error) throw error;
    res.json(bookings || []);
  } catch (error) {
    console.error('Get ride bookings error:', error);
    res.status(500).json({ message: 'Failed to get bookings' });
  }
});

// Cancel booking
app.patch('/api/bookings/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const { data: booking, error: fetchError } = await supabase
      .from('ride_bookings')
      .select('*, ride:rides(*)')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }
    if (booking.passenger_id !== req.userId) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (booking.booking_status === 'cancelled') {
      return res.status(400).json({ message: 'Booking already cancelled' });
    }

    await supabase
      .from('ride_bookings')
      .update({ booking_status: 'cancelled' })
      .eq('id', req.params.id);

    // Restore seats
    await supabase
      .from('rides')
      .update({ available_seats: booking.ride.available_seats + booking.seats_booked })
      .eq('id', booking.ride_id);

    // Send notification to driver
    const passenger = await getUser(req.userId);
    const pickupDate = new Date(booking.ride.pickup_time);
    const formattedDate = pickupDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const formattedTime = pickupDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    const newAvailableSeats = booking.ride.available_seats + booking.seats_booked;

    const messageText = `🚫 Booking Cancelled\n\n${passenger?.name || 'A passenger'} has cancelled their booking.\n\n📍 Route: ${booking.ride.pickup_address} → ${booking.ride.drop_address}\n📅 Date: ${formattedDate} at ${formattedTime}\n🪑 Seats cancelled: ${booking.seats_booked}\n💰 Refund: ₹${booking.total_price}\n\nYour ride now has ${newAvailableSeats} seats available.`;

    await supabase.from('ride_messages').insert({
      ride_id: booking.ride_id,
      sender_id: req.userId,
      receiver_id: booking.ride.driver_id,
      message: messageText,
      message_type: 'text'
    });

    const { data: updated } = await supabase
      .from('ride_bookings')
      .select()
      .eq('id', req.params.id)
      .single();

    res.json(updated);
  } catch (error) {
    console.error('Cancel booking error:', error);
    res.status(500).json({ message: 'Failed to cancel booking' });
  }
});

// ============ MESSAGES ROUTES ============

// Get conversations
app.get('/api/messages/conversations', authenticateToken, async (req, res) => {
  try {
    const { data: messages, error } = await supabase
      .from('ride_messages')
      .select('*, ride:rides(pickup_address, drop_address), sender:users!ride_messages_sender_id_fkey(name), receiver:users!ride_messages_receiver_id_fkey(name)')
      .or(`sender_id.eq.${req.userId},receiver_id.eq.${req.userId}`)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Group by conversation (ride + other user)
    const conversationMap = new Map();
    for (const msg of messages || []) {
      const otherUserId = msg.sender_id === req.userId ? msg.receiver_id : msg.sender_id;
      const key = `${msg.ride_id}-${otherUserId}`;
      if (!conversationMap.has(key)) {
        conversationMap.set(key, {
          id: key,
          ride_id: msg.ride_id,
          ride: msg.ride,
          other_user_id: otherUserId,
          other_user_name: msg.sender_id === req.userId ? msg.receiver?.name : msg.sender?.name,
          last_message: msg.message,
          last_message_time: msg.created_at,
          unread_count: msg.receiver_id === req.userId && !msg.is_read ? 1 : 0
        });
      } else if (msg.receiver_id === req.userId && !msg.is_read) {
        conversationMap.get(key).unread_count++;
      }
    }

    res.json(Array.from(conversationMap.values()));
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ message: 'Failed to get conversations' });
  }
});

// Get messages for a conversation
app.get('/api/messages/:odUserId/:rideId', authenticateToken, async (req, res) => {
  try {
    const { data: messages, error } = await supabase
      .from('ride_messages')
      .select('*, sender:users!ride_messages_sender_id_fkey(name)')
      .eq('ride_id', req.params.rideId)
      .or(`and(sender_id.eq.${req.userId},receiver_id.eq.${req.params.odUserId}),and(sender_id.eq.${req.params.odUserId},receiver_id.eq.${req.userId})`)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json(messages || []);
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ message: 'Failed to get messages' });
  }
});

// Send message
app.post('/api/messages', authenticateToken, async (req, res) => {
  try {
    const { receiver_id, ride_id, message } = req.body;

    const { data: newMessage, error } = await supabase
      .from('ride_messages')
      .insert({
        ride_id,
        sender_id: req.userId,
        receiver_id,
        message,
        message_type: 'text'
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(newMessage);
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ message: 'Failed to send message' });
  }
});

// Mark message as read
app.patch('/api/messages/:id/read', authenticateToken, async (req, res) => {
  try {
    await supabase
      .from('ride_messages')
      .update({ is_read: true })
      .eq('id', req.params.id)
      .eq('receiver_id', req.userId);

    res.json({ success: true });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({ message: 'Failed to mark as read' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default app;
