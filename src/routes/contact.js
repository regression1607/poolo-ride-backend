import express from 'express';
import nodemailer from 'nodemailer';

const router = express.Router();

// Create transporter - configure with your email service
const createTransporter = () => {
  // Using environment variables for email configuration
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

// POST /api/contact - Send contact form email
router.post('/', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;

    // Validate required fields
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Email to receive contact form submissions
    const receiverEmail = process.env.CONTACT_EMAIL || 'support@poolo.in';

    const transporter = createTransporter();

    // Email to admin/support
    const mailOptions = {
      from: `"Poolo Contact Form" <${process.env.SMTP_USER}>`,
      to: receiverEmail,
      replyTo: email,
      subject: `[Poolo Contact] ${subject}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #10B981, #059669); padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">New Contact Form Submission</h1>
          </div>
          <div style="padding: 30px; background: #f9fafb;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: bold; width: 100px;">Name:</td>
                <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${name}</td>
              </tr>
              <tr>
                <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Email:</td>
                <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;"><a href="mailto:${email}">${email}</a></td>
              </tr>
              <tr>
                <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Subject:</td>
                <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${subject}</td>
              </tr>
            </table>
            <div style="margin-top: 20px;">
              <h3 style="color: #374151; margin-bottom: 10px;">Message:</h3>
              <div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #e5e7eb;">
                ${message.replace(/\n/g, '<br>')}
              </div>
            </div>
          </div>
          <div style="padding: 15px; background: #1f2937; text-align: center;">
            <p style="color: #9ca3af; margin: 0; font-size: 12px;">
              This email was sent from the Poolo contact form
            </p>
          </div>
        </div>
      `,
      text: `
New Contact Form Submission

Name: ${name}
Email: ${email}
Subject: ${subject}

Message:
${message}
      `,
    };

    // Send email
    await transporter.sendMail(mailOptions);

    // Send auto-reply to user
    const autoReplyOptions = {
      from: `"Poolo Support" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Thanks for contacting Poolo!',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #10B981, #059669); padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">Thank You!</h1>
          </div>
          <div style="padding: 30px; background: #f9fafb;">
            <p style="font-size: 16px; color: #374151;">Hi ${name},</p>
            <p style="font-size: 16px; color: #374151;">
              Thank you for reaching out to us! We have received your message and will get back to you within 24 hours.
            </p>
            <div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #e5e7eb; margin: 20px 0;">
              <p style="margin: 0; color: #6b7280;"><strong>Your message:</strong></p>
              <p style="margin: 10px 0 0 0; color: #374151;">${message.replace(/\n/g, '<br>')}</p>
            </div>
            <p style="font-size: 16px; color: #374151;">
              Best regards,<br>
              <strong>The Poolo Team</strong>
            </p>
          </div>
          <div style="padding: 15px; background: #1f2937; text-align: center;">
            <p style="color: #9ca3af; margin: 0; font-size: 12px;">
              Poolo - Share Rides, Save Money
            </p>
          </div>
        </div>
      `,
    };

    // Try to send auto-reply (don't fail if this fails)
    try {
      await transporter.sendMail(autoReplyOptions);
    } catch (autoReplyError) {
      console.error('Auto-reply failed:', autoReplyError);
    }

    res.json({ message: 'Message sent successfully' });
  } catch (error) {
    console.error('Contact form error:', error);
    res.status(500).json({ message: 'Failed to send message. Please try again later.' });
  }
});

export default router;
