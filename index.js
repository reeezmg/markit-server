const express = require('express');
const cors = require('cors');
require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');

const app = express();

// CORS setup
app.use(cors({
  origin: [
    'http://localhost:8100', // Ionic mobile app (dev)
    'http://localhost:8101', // Ionic mobile app (dev)
    'http://localhost:3000', // React/Next dashboard
    'https://markit.co.in'   // Production domain
  ],
  credentials: true,
}));

app.use(express.json());

// instead of app.listen
const port = process.env.PORT || 3005;
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: [
      'http://localhost:8100',
      'http://localhost:8101',
      'http://localhost:3000',
      'https://markit.co.in'
    ],
    credentials: true,
  },
});

// ---------------- SOCKET EVENTS ----------------
io.on('connection', (socket) => {
  console.log('🔌 A user connected:', socket.id);

  // ---------------- COMPANY SOCKET ----------------
  socket.on('joinCompany', (companyId) => {
    if (!companyId) return;
    socket.join(`company:${companyId}`);
    console.log(`🏢 Socket ${socket.id} joined room company:${companyId}`);
  });

  // ---------------- CLIENT SOCKET ----------------
  socket.on('joinClient', (clientId) => {
    if (!clientId) return;
    socket.join(`client:${clientId}`);
    console.log(`👤 Socket ${socket.id} joined room client:${clientId}`);
  });

  // ---------------- DISCONNECT ----------------
  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
  });
});

// ---------------- ROUTES ----------------
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/product');
const shopRoutes = require('./routes/shop');
const addressRoutes = require('./routes/address');
const checkoutRoutes = require('./routes/checkout')(io);
const historyRoutes = require('./routes/history');
const mapRoutes = require('./routes/map');
const devicesRoutes = require('./routes/devices');
const clientRoutes = require('./routes/client');
const packRoutes = require('./routes/pack')(io);

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/shops', shopRoutes);
app.use('/api/address', addressRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/map', mapRoutes);
app.use('/api/client', clientRoutes);
app.use('/api/pack', packRoutes);

// ---------------- START SERVER ----------------
server.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
