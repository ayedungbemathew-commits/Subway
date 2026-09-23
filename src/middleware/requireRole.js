function requireRole(...allowedRoles) {
  return function (req, res, next) {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions." });
    }
    next();
  };
}

module.exports = { requireRole };