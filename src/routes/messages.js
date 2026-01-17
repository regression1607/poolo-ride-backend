import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get conversations
router.get('/conversations', authenticateToken, (req, res) => {
  try {
    const conversations = db.prepare(`
      SELECT DISTINCT 
        CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END as partnerId,
        u.name as partnerName,
        m.ride_id as rideId,
        r.pickup_address,
        r.drop_address,
        MAX(m.sent_at) as lastMessageTime,
        (SELECT message FROM ride_messages WHERE 
          (sender_id = ? AND receiver_id = u.id) OR (sender_id = u.id AND receiver_id = ?)
          ORDER BY sent_at DESC LIMIT 1) as lastMessage
      FROM ride_messages m
      JOIN users u ON u.id = CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END
      LEFT JOIN rides r ON r.id = m.ride_id
      WHERE m.sender_id = ? OR m.receiver_id = ?
      GROUP BY partnerId
      ORDER BY lastMessageTime DESC
    `).all(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id);

    // Format response with route info
    const formatted = conversations.map(conv => ({
      id: `${conv.rideId}-${conv.partnerId}`,
      partnerId: conv.partnerId,
      partnerName: conv.partnerName,
      rideId: conv.rideId,
      route: conv.pickup_address && conv.drop_address 
        ? `${conv.pickup_address} → ${conv.drop_address}` 
        : 'Unknown Route',
      lastMessage: conv.lastMessage,
      lastMessageTime: conv.lastMessageTime,
      unreadCount: 0
    }));

    res.json(formatted);
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ message: 'Failed to get conversations' });
  }
});

// Get messages with a user
router.get('/:conversationId', authenticateToken, (req, res) => {
  try {
    const messages = db.prepare(`
      SELECT m.*, u.name as sender_name
      FROM ride_messages m
      JOIN users u ON m.sender_id = u.id
      WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)
      ORDER BY m.sent_at ASC
    `).all(req.user.id, req.params.conversationId, req.params.conversationId, req.user.id);

    res.json(messages);
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ message: 'Failed to get messages' });
  }
});

// Send message
router.post('/', authenticateToken, (req, res) => {
  try {
    const { receiver_id, ride_id, message } = req.body;

    if (!receiver_id || !ride_id || !message) {
      return res.status(400).json({ message: 'receiver_id, ride_id, and message are required' });
    }

    const messageId = uuidv4();
    db.prepare(`
      INSERT INTO ride_messages (id, ride_id, sender_id, receiver_id, message)
      VALUES (?, ?, ?, ?, ?)
    `).run(messageId, ride_id, req.user.id, receiver_id, message);

    const newMessage = db.prepare('SELECT * FROM ride_messages WHERE id = ?').get(messageId);
    res.status(201).json(newMessage);
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ message: 'Failed to send message' });
  }
});

// Mark message as read
router.patch('/:id/read', authenticateToken, (req, res) => {
  try {
    db.prepare('UPDATE ride_messages SET is_read = 1 WHERE id = ? AND receiver_id = ?').run(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ message: 'Failed to mark message as read' });
  }
});

export default router;
