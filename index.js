const express = require('express');
const cors = require('cors');
require('dotenv').config();
const http = require('http');       // <-- add this
const { Server } = require('socket.io'); // <-- add this

const app = express();

// CORS setup
app.use(cors({
  origin: 'http://localhost:8100',
  credentials: true,
}));

app.use(express.json());

// instead of app.listen
const port = process.env.PORT || 3005;
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ['http://localhost:8100', 'http://localhost:3000'],
    credentials: true,
  },
});


// socket events
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // client tells us which company they belong to
  socket.on('joinCompany', (companyId) => {
    socket.join(`company:${companyId}`);
    console.log(`Socket ${socket.id} joined room company:${companyId}`);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// route-based loading
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/product');
const shopRoutes = require('./routes/shop');
const addressRoutes = require('./routes/address');
const checkoutRoutes = require('./routes/checkout')(io);
const historyRoutes = require('./routes/history');
const mapRoutes = require('./routes/map');
const devicesRoutes = require('./routes/devices');
const clientRoutes = require('./routes/client');

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/shops', shopRoutes);
app.use('/api/address', addressRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/map', mapRoutes);
app.use('/api/client', clientRoutes);



server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
