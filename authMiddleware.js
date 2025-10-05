const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'your-secret';

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(' ')[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, SECRET, (err, payload) => {
    console.log("JWT verification error:", err);
    if (err) return res.sendStatus(403);
    req.user = payload;
    next();
  });
}
module.exports = authenticateToken;