const express = require('express');
// const nodemailer = require('nodemailer');

const router = express.Router();

// const transporter = nodemailer.createTransport({
//     host: process.env.SMTP_HOST,
//     port: Number(process.env.SMTP_PORT || 587),
//     secure: process.env.SMTP_SECURE === 'true',
//     auth: process.env.SMTP_USER
//         ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
//         : undefined,
// });

// Helper to escape HTML
const escapeHtml = (str = "") =>
    str.replace(/</g, "&lt;").replace(/>/g, "&gt;");

// router.post('/', async (req, res) => {
//     const { title, query, fromEmail, fromName } = req.body || {};

//     if (!title || !query) {
//         return res.status(400).json({ error: 'title and query are required' });
//     }

//     if (fromEmail && !/^\S+@\S+\.\S+$/.test(fromEmail)) {
//         return res.status(400).json({ error: 'Invalid email address' });
//     }

//     const supportAddress = process.env.SUPPORT_EMAIL || 'support@markit.co.in';
//     const from = fromEmail
//         ? `${fromName || 'User'} <${fromEmail}>`
//         : `no-reply@markit.co.in`;

//     const safeQuery = escapeHtml(query).replace(/\n/g, '<br/>');

//     const mailOptions = {
//         from,
//         replyTo: fromEmail || undefined,
//         to: supportAddress,
//         subject: `[Help & Support] ${title}`,
//         text: `From: ${from}\n\n${query}`,
//         html: `
//             <p><strong>From:</strong> ${from}</p>
//             <p><strong>Title:</strong> ${title}</p>
//             <p><strong>Message:</strong></p>
//             <p>${safeQuery}</p>
//         `
//     };

//     try {
//         await transporter.sendMail(mailOptions);
//         return res.status(200).json({ message: 'Support request sent' });
//     } catch (err) {
//         console.error('Error sending support email:', err);
//         return res.status(500).json({ error: 'Failed to send support email' });
//     }
// });

module.exports = router;
