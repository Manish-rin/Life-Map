/**
 * Returns an Express middleware that validates req.body against a Zod schema.
 * On failure → 400 with structured field errors.
 */
function validate(schema, target = 'body') {
  return (req, res, next) => {
    const source = target === 'query' ? req.query : req.body;
    const result = schema.safeParse(source);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        issues: result.error.flatten().fieldErrors,
      });
    }
    if (target === 'query') {
      req.query = result.data;
    } else {
      req.body = result.data;
    }
    next();
  };
}

module.exports = { validate };
