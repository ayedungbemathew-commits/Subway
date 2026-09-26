function parseId(value) {
  const id = parseInt(value, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return id;
}

module.exports = { parseId };
