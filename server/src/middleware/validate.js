const { z } = require('zod');

/**
 * validate(schema)
 * Zod schema validation middleware factory.
 * Validates req.body and replaces it with the coerced/sanitized output.
 *
 * Usage:
 *   router.post('/', validate(assetSchema), ctrl.create)
 */
const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);

  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      field:   i.path.join('.') || 'body',
      message: i.message,
    }));
    return res.status(400).json({ error: 'Validation failed', issues });
  }

  req.body = result.data; // use sanitized + coerced values
  next();
};

// ── Shared field validators ──────────────────────────────────
const uuidField   = z.string().uuid('Must be a valid UUID');
const dateField   = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional().nullable();
const priceField  = z.number().positive('Must be a positive number').optional().nullable();

// ── Asset schemas ────────────────────────────────────────────
const assetCreateSchema = z.object({
  name:                       z.string().min(2).max(150),
  asset_tag:                  z.string().max(50).optional().nullable(),
  serial_number:              z.string().max(100).optional().nullable(),
  brand:                      z.string().max(100).optional().nullable(),
  model:                      z.string().max(100).optional().nullable(),
  category_id:                uuidField,
  location_id:                uuidField.optional().nullable(),
  supplier_id:                uuidField.optional().nullable(),
  assigned_to:                uuidField.optional().nullable(),
  assigned_since:             dateField,
  purchase_date:              dateField,
  purchase_price:             priceField,
  invoice_number:             z.string().max(100).optional().nullable(),
  warranty_expiry:            dateField,
  status:                     z.enum(['available','assigned','maintenance','retired','lost','disposed']).optional(),
  next_maintenance_date:      dateField,
  maintenance_interval_days:  z.number().int().positive().optional().nullable(),
  notes:                      z.string().max(2000).optional().nullable(),
});

const assetUpdateSchema = assetCreateSchema.partial(); // all fields optional on PATCH

const assetStatusSchema = z.object({
  status: z.enum(['available','assigned','maintenance','retired','lost','disposed']),
  notes:  z.string().max(500).optional(),
});

// ── User schemas ─────────────────────────────────────────────
const userCreateSchema = z.object({
  name:       z.string().min(2).max(100),
  email:      z.string().email('Invalid email address').max(150),
  password:   z.string()
                .min(8, 'Password must be at least 8 characters')
                .regex(/[A-Z]/, 'Must contain an uppercase letter')
                .regex(/[0-9]/, 'Must contain a number'),
  role:       z.enum(['admin','engineer','inventory manager','readonly']).optional().default('readonly'),
  phone:      z.string().max(20).optional().nullable(),
  department: z.string().max(100).optional().nullable(),
});

const userUpdateSchema = z.object({
  name:       z.string().min(2).max(100).optional(),
  phone:      z.string().max(20).optional().nullable(),
  department: z.string().max(100).optional().nullable(),
  role:       z.enum(['admin','engineer','inventory manager','readonly']).optional(),
});

const passwordChangeSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password:     z.string()
                      .min(8)
                      .regex(/[A-Z]/, 'Must contain an uppercase letter')
                      .regex(/[0-9]/, 'Must contain a number'),
});

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

module.exports = {
  validate,
  assetCreateSchema,
  assetUpdateSchema,
  assetStatusSchema,
  userCreateSchema,
  userUpdateSchema,
  passwordChangeSchema,
  loginSchema,
};
