import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, username, phone_number } = req.body;

    if (!email || !password || !name || !username) {
      return res.status(400).json({ message: 'Email, password, name, and username are required' });
    }

    // Check if user exists
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
    if (existingUser) {
      return res.status(400).json({ message: 'Email or username already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();

    // Create user
    db.prepare(`
      INSERT INTO users (id, email, password, name, username, phone_number)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, email, hashedPassword, name, username, phone_number || null);

    const user = db.prepare('SELECT id, email, name, username, phone_number, rating, total_rides, is_verified, created_at FROM users WHERE id = ?').get(userId);

    // Generate token
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ user, token });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ message: 'Failed to register user' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    const { password: _, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword, token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Failed to login' });
  }
});

// Get profile
router.get('/profile', authenticateToken, (req, res) => {
  const { password: _, ...userWithoutPassword } = req.user;
  res.json(userWithoutPassword);
});

// Update profile
router.put('/profile', authenticateToken, (req, res) => {
  try {
    const { name, phone_number } = req.body;
    const userId = req.user.id;

    db.prepare(`
      UPDATE users SET name = COALESCE(?, name), phone_number = COALESCE(?, phone_number), updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name, phone_number, userId);

    const user = db.prepare('SELECT id, email, name, username, phone_number, rating, total_rides, is_verified, created_at FROM users WHERE id = ?').get(userId);
    res.json(user);
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Failed to update profile' });
  }
});

export default router;
